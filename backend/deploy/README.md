# Convolve production deployment: dependencies, verified state, remaining steps

Status on 2026-10-18: the release in this branch is **validated but not deployed**.
Production still runs the previous API (`convolve-backend-pipeline`) and bots job
(`convolve-run-due-bots`) on Alembic revision `289c17a09fbb`. Only the standalone
Supabase Data API lockdown (`supabase_lockdown/`) has been applied to production.

Nothing in this directory is applied automatically. Every command below is a
production change that needs its own explicit approval.

Placeholders: `<ref>` is the Supabase project ref, `$P` is
`project-23824ae4-252f-40b9-94a`, `$R` is `europe-west6`, `$BUCKET` is
`convolve-model-storage-425091235607`. Never paste real credentials into this repo,
into shell history or into logs; secrets go into Secret Manager via stdin.

## Files

| File | Purpose |
|---|---|
| `trainer-job.yaml` | Cloud Run Job spec for the CNN trainer (`gcloud run jobs replace`). |
| `cloudbuild-release.yaml` | Builds the backend image and verifies imports, ML pins, no numba, no `.env`, Alembic head. |
| `upload-cors.json` | Bucket CORS so browsers can PUT large uploads straight to GCS. |
| `upload-lifecycle.json` | Deletes abandoned staged uploads under `uploads/` after 1 day. |
| `supabase_lockdown/` | Standalone Data API lockdown (already applied) with verify and rollback scripts. |
| `staging_e2e/` | Staging-only end-to-end drivers (see below). |

## Deployment dependencies

One image digest is shared by three workloads. Keras 3.14 cannot load models saved
by 3.15, so the API, trainer job and bots job must never run different digests.

| Component | Depends on |
|---|---|
| Backend image | Built from a committed tree (`git archive <commit> backend`) with `cloudbuild-release.yaml`; Python 3.11, tensorflow 2.21.0, keras 3.15.1 |
| Supabase Postgres 17.6 | Alembic head `f3d9b2c71a40`; session pooler `aws-0-eu-west-1.pooler.supabase.com:5432`, user `postgres.<ref>`, `sslmode=require` |
| Supabase Auth | Site URL and redirect URLs for `/auth/callback` and `/reset-password` on the production frontend origin |
| Secret Manager | `secretmanager.googleapis.com` (enabled); one `DATABASE_URL` secret (pooler URL), plus `SUPABASE_JWT_SECRET` if HS256 verification is used |
| Model bucket | `$BUCKET`; durable artifacts under `users/{uid}/...` and `keras/{uid}/...`, staged uploads under `uploads/{uid}/{upload_id}/` |
| API service | Env: `APP_PROFILE=cloud`, `MODEL_BUCKET`, `DATABASE_URL` (secret), `AUTH_REQUIRED`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET` (secret, optional with JWKS), `CORS_ORIGINS`, `TRAINER_EXECUTION=cloud_run_job`, `TRAINER_JOB_NAME`, `TRAINER_JOB_PROJECT`, `TRAINER_JOB_REGION`, `LIVE_DEPLOY_ENABLED`, `SCHEDULED_BOTS_ENABLED` |
| Trainer job | `trainer-job.yaml`; started by the API with `CONVOLVE_RUN_ID` as the only override |
| Bots job | Same image and `DATABASE_URL`/`MODEL_BUCKET` as the API; `AUTH_REQUIRED` must match the API |
| Frontend (Vercel) | Build env `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

### Service accounts and IAM (least privilege)

Use one dedicated service account per workload. None needs a project-level role
except where stated; bind roles on the individual resource.

| Account | Role | Resource |
|---|---|---|
| API (`convolve-api`) | `roles/secretmanager.secretAccessor` | DB URL secret (and JWT secret) |
| | `roles/storage.objectAdmin` | `$BUCKET` (bucket-level) |
| | `roles/run.jobsExecutorWithOverrides` | job `convolve-trainer` |
| | `roles/run.viewer` | job `convolve-trainer` (execution status and cancel lookup) |
| Trainer (`convolve-trainer`) | `roles/secretmanager.secretAccessor` | DB URL secret |
| | `roles/storage.objectAdmin` | `$BUCKET` (bucket-level) |
| Bots job (`convolve-bots`) | `roles/secretmanager.secretAccessor` | DB URL secret |
| | `roles/storage.objectViewer` | `$BUCKET` (bucket-level) |

Staging ran the API and trainer under one account. With separate accounts, if the
API's execution request is rejected with an `iam.serviceAccounts.actAs` error, grant
the API account `roles/iam.serviceAccountUser` on the trainer account only.

The resumable upload sessions are opened by the API with its own credentials, so no
URL signing (`iam.serviceAccountTokenCreator`) is required.

## Remaining production-only steps, in order

Each step is a production change and requires approval. Steps 1-5 can happen while
the old API keeps serving, because the new tables are additive and the lockdown
migration is idempotent with the already applied standalone lockdown.

1. **Build the image** from the release commit into `convolve-repo` and record the digest:
   ```bash
   git archive <release-commit> backend | tar -x -C /tmp/rel && cd /tmp/rel/backend
   gcloud builds submit --project=$P --region=$R --config=deploy/cloudbuild-release.yaml \
     --substitutions=_IMAGE=$R-docker.pkg.dev/$P/convolve-repo/backend,_TAG=<release-tag> .
   ```
2. **Back up and migrate the database.** Take a fresh backup (`supabase_lockdown/backup.py`
   or the Supabase dashboard), then from the release tree with the pooler URL read via
   `read -rs`:
   ```bash
   alembic current          # expect 289c17a09fbb
   alembic upgrade head     # 289c17a09fbb -> ... -> f3d9b2c71a40
   ```
   Then re-run `supabase_lockdown/03_verify.sql` and confirm the new tables
   (`profiles`, `pipeline_runs`, `user_datasets`, `user_models`) have RLS on and no
   anon/authenticated grants. The old API keeps working on the migrated schema
   (`test_existing_bot_schema_upgrades_and_keeps_rows`).
3. **Secrets.** Create the DB URL secret (session pooler URL with `postgresql+psycopg2://`
   and `sslmode=require`) and, if used, the JWT secret, from stdin:
   ```bash
   gcloud secrets create convolve-database-url --project=$P \
     --replication-policy=user-managed --locations=$R
   printf %s "$DATABASE_URL" | gcloud secrets versions add convolve-database-url --data-file=-
   ```
4. **Service accounts and IAM** as in the table above.
5. **Bucket configuration.** Apply CORS and the lifecycle rule, then confirm the lifecycle
   matches only `uploads/`:
   ```bash
   gcloud storage buckets update gs://$BUCKET --cors-file=deploy/upload-cors.json
   gcloud storage buckets update gs://$BUCKET --lifecycle-file=deploy/upload-lifecycle.json
   gcloud storage buckets describe gs://$BUCKET --format="yaml(cors_config,lifecycle_config)"
   ```
   `upload-cors.json` lists `https://www.we-convolve.com` and `https://we-convolve.com`;
   add any other production frontend origin before applying.
6. **Trainer job.** Fill in `trainer-job.yaml`, `gcloud run jobs replace` it, then run one
   execution with `--args=-m,app.jobs.train_worker,--check`. Every line must be `OK`.
7. **API.** Deploy the same digest to `convolve-backend-pipeline` with `AUTH_REQUIRED=false`
   first, `TRAINER_EXECUTION=cloud_run_job`, and the API service account. Smoke test with
   the existing frontend.
8. **Bots job.** Point `convolve-run-due-bots` at the same digest, the bots service account,
   `MODEL_BUCKET` and the secret-backed `DATABASE_URL`. Keep `SCHEDULED_BOTS_ENABLED` and
   `LIVE_DEPLOY_ENABLED` as they are today until bots are deliberately re-enabled.
9. **Authentication cutover.**
   - Configure Supabase Auth site URL and redirect URLs; deploy the frontend with the
     `VITE_SUPABASE_*` variables.
   - Run `python -m app.services.legacy_cutover --user-id <founder-uuid>` (dry run), review,
     then `--apply`. This assigns the `local-user`/`prod-user` rows and unowned files to the
     founder's Supabase account. It also resolves the current mismatch where `/api/bots`
     returns an empty list because the production bots are owned by `local-user`.
   - Set `AUTH_REQUIRED=true` on the API **and** the bots job in the same change.
10. **Retire leftovers.** Delete the unused `convolve-staging-runner` service account and
    the `convolve-staging` Artifact Registry images once no longer needed.

### Bot runner compatibility

- With `AUTH_REQUIRED=false` the bots job only runs active bots whose `user_id` equals
  `USER_ID` or is NULL; with `AUTH_REQUIRED=true` it runs all active bots. If the API and
  the bots job disagree, bots are silently skipped, so switch both together.
- Bots created by the new API store models as `gcs://$BUCKET/keras/{uid}/{bot}.keras`.
  The current production bots image cannot read those paths or Keras 3.15 models; update
  the bots job image in the same rollout as the API.
- Staging verified one scheduled batch end to end on the release image
  (`candidates=1 success=1 error=0`).

## Verified results (release commits `f7f6296`, `66ac6b6`, `cb709ed`)

| Check | Result |
|---|---|
| Local test suite, SQLite | 107 passed, 57 skipped (the skips are the Postgres-only tests) |
| Local test suite, PostgreSQL 17.6 (production-shaped replica, non-superuser owner) | 164 passed |
| Release image build (`cloudbuild-release.yaml`, E2_HIGHCPU_8) | 4 min 4 s; imports, pins (tensorflow 2.21.0, keras 3.15.1), no numba, no `.env`, Alembic head `f3d9b2c71a40` |
| Production Data API lockdown | Applied and verified; anon/authenticated get `42501`; API behaviour unchanged |
| Cloud Run Job to production Supabase (`train_worker --check`, temporary job, read-only) | Pooler reachable over TLS, read-only session as `postgres` on 17.6, RLS compatible, tables closed to browser roles. Expected failures: schema revision `289c17a09fbb`, worker tables missing, no bucket access. 12 s billed task time, 55 s end to end |
| Staging end to end (Cloud SQL, staging bucket) | 117.7 MiB dataset direct upload in 14.7 s plus 4.0 s finalize; 127.9 MiB model upload and download (download streamed in 23.3 s, loads in Keras 3.15.1); training run done in 53 s; cancel and failure paths; cross-user isolation returns 404; oversize init returns 413; scheduled bot batch succeeded |

## Known limitations and risks

- **TLS certificate verification.** `sslmode=require` encrypts but does not verify the
  server certificate, so an attacker on the network path could impersonate the pooler.
  Hardening: ship the Supabase CA certificate in the image and use
  `sslmode=verify-full&sslrootcert=/app/certs/supabase-ca.crt`. Not done yet.
- **Database role.** The API, trainer and bots job all connect as `postgres`, which owns
  the tables and has `BYPASSRLS`. App-level ownership checks are the only tenant
  isolation; a dedicated least-privilege role per workload is a future database change.
- **SQLAlchemy pooling.** Each process uses `pool_size=5`, `max_overflow=10`,
  `pool_pre_ping=True`, so up to 15 pooler connections per API instance, trainer
  execution and bots job. Supavisor session mode caps clients per user and database by
  compute tier. Keep `(API max instances x 15) + concurrent trainer executions x 15 + 15`
  below that cap, or lower the pool size for jobs. Only the session pooler (5432) has
  been tested; the transaction pooler (6543) has not.
- **Supabase default ACLs.** `supabase_admin` default privileges in `public` still grant
  anon/authenticated on future tables it creates. Tables created by `postgres` (all
  migrations) are covered; `03_verify.sql` flags any exception.
- **Single-attempt training.** `maxRetries: 0`, no checkpoints; a crashed execution is
  marked failed after `TRAINER_JOB_STALE_SECONDS` (300 s).
- **Model metadata matching** on direct model uploads returned `metadata_matched=false`
  in staging (the upload had no sidecar); harmless but visible in the UI.

## Staging end-to-end drivers (`staging_e2e/`)

`driver.py` (training happy path, cancel, failure, isolation, forged tokens) and
`driver2.py` (large direct uploads, archive storage, model upload, bot creation and
scheduled batch, isolation). They refuse to run unless `STAGING_API_URL` and
`STAGING_BUCKET` contain `staging`, and read `STAGING_JWT_SECRET` from the environment;
they never print tokens or upload URLs.

Originally kept in `/tmp/convolve-staging/e2e/`; test data (`dataset240.zip`,
`dataset_big.zip`, about 120 MiB) and results stay there and are not committed. The
staged-upload check in `driver2.py` uses the current prefix `uploads/{uid}/{upload_id}/`.

```bash
cd deploy/staging_e2e
STAGING_API_URL=... STAGING_BUCKET=... STAGING_JWT_SECRET=... python driver.py happy
python driver2.py upload   # then: train, download, model_upload, bot_result
```

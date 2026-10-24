# Convolve production deployment: dependencies, verified state, remaining steps

Status on 2026-10-24: production runs release `adada06` (image
`backend@sha256:27556c5f3d34…`) on the API (`convolve-backend-pipeline`), the trainer job and
the bots job (`convolve-run-due-bots`), on Alembic head `c5f8a3d1e290`. `AUTH_REQUIRED=true`,
`LIVE_DEPLOY_ENABLED=true` and `SCHEDULED_BOTS_ENABLED=true` on the API and the bots job;
Cloud Scheduler `convolve-daily-run` starts the bots job every 15 minutes as
`convolve-scheduler`. Credits are off. The legacy `local-user` bots were assigned to the
founder account (one archived, one paused: its model file was never in the bucket).

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
| `bots-job.yaml` | Cloud Run Job spec for scheduled paper bots (`convolve-run-due-bots`). |
| `cloudbuild-release.yaml` | Builds the backend image and verifies imports, ML pins, no `.env`, Alembic head. |
| `upload-cors.json` | Bucket CORS so browsers can PUT large uploads straight to GCS. |
| `upload-lifecycle.json` | Deletes abandoned staged uploads under `uploads/` after 1 day and training checkpoints under `checkpoints/` after 14 days. |
| `trainer-job-gpu.yaml` | Optional Cloud Run L4 trainer job (EU regions only, outside CH). Not applied. |
| `trainer-batch-gpu-zurich.json` | Optional Cloud Batch G2 (L4) job body for Zurich. Not applied. |
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
| API service | Env: `APP_PROFILE=cloud`, `BOT_INPROCESS_SCHEDULER=false` (the default under `cloud`), `BOT_JOB_NAME=convolve-run-due-bots`, `MODEL_BUCKET`, `DATABASE_URL` (secret), `AUTH_REQUIRED`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET` (secret, optional with JWKS), `CORS_ORIGINS`, `TRAINER_EXECUTION=cloud_run_job`, `TRAINER_JOB_NAME`, `TRAINER_JOB_PROJECT`, `TRAINER_JOB_REGION`, `LIVE_DEPLOY_ENABLED`, `SCHEDULED_BOTS_ENABLED`, `CREDITS_MODE` (leave unset = `off`) |
| Trainer job | `trainer-job.yaml`; started by the API with `CONVOLVE_RUN_ID` as the only override |
| Bots job | `bots-job.yaml`; same image and `DATABASE_URL`/`MODEL_BUCKET` as the API; `AUTH_REQUIRED` must match the API |
| Cloud Scheduler | `convolve-daily-run`, every 15 min, calls the Cloud Run Admin API `jobs:run` with an OAuth token |
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
| | `roles/run.invoker` | job `convolve-run-due-bots` (first run right after deploy) |
| Trainer (`convolve-trainer`) | `roles/secretmanager.secretAccessor` | DB URL secret |
| | `roles/storage.objectAdmin` | `$BUCKET` (bucket-level) |
| Bots job (`convolve-bots`) | `roles/secretmanager.secretAccessor` | DB URL secret |
| | `roles/storage.objectAdmin` | `$BUCKET` (bucket-level; reads models, writes run charts and heatmaps) |
| Scheduler caller (`convolve-scheduler`) | `roles/run.invoker` | job `convolve-run-due-bots` (includes `run.jobs.run`) |

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
5. **Bucket configuration.** Apply CORS and the lifecycle rules, then confirm the lifecycle
   matches only `uploads/` and `checkpoints/`:
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
8. **Bots job.** Fill in `bots-job.yaml` and `gcloud run jobs replace` it (same digest, the
   bots service account, `MODEL_BUCKET`, the secret-backed `DATABASE_URL`). Keep
   `SCHEDULED_BOTS_ENABLED` and `LIVE_DEPLOY_ENABLED` false until bots are deliberately
   re-enabled; see "Scheduled bots" below for the trigger and the enabling sequence.
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

### Accounts, terms and credits (migration `b9d4e2f7c813`)

`b9d4e2f7c813` follows `... -> f3d9b2c71a40 -> a7c3e5f19b62`; the current head is
`c5f8a3d1e290` (see "Scheduled bots").
It is additive: three nullable `profiles` columns (`terms_version`, `privacy_version`,
`terms_accepted_at`), `credit_ledger.tool`/`note`, a `balance >= 0` check on
`credit_accounts`, and two new private tables, `user_plans` and `deleted_accounts`, with
RLS on and anon/authenticated grants revoked. Re-run `03_verify.sql` afterwards and confirm
both new tables appear as locked down.

- **Credits stay off.** `CREDITS_MODE` defaults to `off`: nothing is granted or charged and
  the UI shows "Beta". Do not set `CREDITS_MODE=enforce` in production until the monthly
  allocation, prices and the treatment of existing users are decided. Enforcing grants
  every user the free plan's one-time 50 credits on first use and charges `RUN_COSTS` in
  `app/plans.py` per run; failed and interrupted runs are refunded in full, cancelled runs
  only if they never started, and a startup sweep refunds runs left behind by a crash.
  There is no HTTP endpoint for adjustments; operators use
  `app.services.credits.adjust(user_id, delta, note, key)`.
- **Account deletion and `auth.users`.** Deletion removes the Supabase user with
  `delete from auth.users` over `DATABASE_URL`. On Supabase the pooler role may not have
  that privilege. Verify on staging; if the step reports `auth_user` failed, the account
  is restored (`restore_sign_in`) and the user is told. The least-privilege fix is a
  `SECURITY DEFINER` function owned by `postgres` that deletes one id, granted only to the
  API role. The `deleted_accounts` tombstone blocks re-provisioning from a still-valid token
  across restarts.
- **Terms.** Signed-in users without the current `TERMS_VERSION` are asked to accept once.
  Bump `TERMS_VERSION`/`PRIVACY_VERSION` in both `app/services/account.py` and
  `src/features/legal/meta.ts` (a test checks they match).

### Scheduled bots (migration `c5f8a3d1e290`)

The current head is `c5f8a3d1e290`. It is additive: bot `timeframe`, chart span and slot
columns; `bot_runs.execution_key` with a unique `(bot_id, execution_key)` constraint;
`bot_trades.decision_bar_at` and a unique `prediction_run_id`. On a database that already
holds duplicate runs or trades for one signal the unique constraints fail; check first:

```sql
select prediction_run_id, count(*) from bot_trades
where prediction_run_id is not null group by 1 having count(*) > 1;
```

How execution works:

- **Trigger.** Cloud Scheduler starts `convolve-run-due-bots` every 15 minutes. The job,
  not the scheduler, decides what is due: each active bot has one slot per day at its
  `run_time` in its IANA `timezone` (DST-aware). A bot runs once per slot; a missed slot
  is caught up once, on the latest slot only. The API never polls in cloud
  (`BOT_INPROCESS_SCHEDULER=false`), so scaling the API cannot start duplicate batches.
- **First run.** A newly deployed bot is due immediately (it has never finished a slot).
  The API asks Cloud Run for one `convolve-run-due-bots` execution (`BOT_JOB_NAME`); if that
  request fails, the next Scheduler tick runs it. Nothing runs inside the HTTP request.
- **Timeframes.** Scheduled bots support daily (`1d`), weekly (`1wk`) and monthly (`1mo`)
  bars only; the API rejects anything else and the Deploy page offers only these. Intraday
  bars are not supported.
- **Bars.** A run evaluates the latest *completed* bar of the bot's timeframe. Daily bars complete 20 minutes after the venue close; weekly and monthly
  bars once the next period starts. If there is no new completed bar (weekend, holiday),
  the slot is recorded as `no_new_data` and nothing is written.
- **Deduplication.** The run is claimed by inserting `(bot_id, "<timeframe>:<bar date>")`.
  A second claim for the same bar (Scheduler retry, overlapping execution, manual run,
  second worker) hits the unique constraint and is skipped. Failed runs are retried by
  later ticks at most every 15 minutes, 3 attempts per bar; a run stuck in `running` for
  15 minutes (crashed worker) is taken over. Trades are unique per signal run.
- **Paper fills.** A BUY fills at the next bar's open plus slippage once that bar has
  completed; stop loss is checked before take profit within a bar, gaps through the stop
  fill at the open, and the horizon counts bars. `GET /api/bots/{id}` returns the exact
  conventions as `execution_assumptions`.

**Why the scheduler returns 403.** `convolve-daily-run` calls the Cloud Run Admin API with
the default compute service account, which has no permission to run the job. Fix (needs
approval; read-only check first):

```bash
gcloud scheduler jobs describe convolve-daily-run --project=$P --location=$R \
  --format="yaml(schedule,timeZone,httpTarget.uri,httpTarget.oauthToken.serviceAccountEmail)"

gcloud iam service-accounts create convolve-scheduler --project=$P
gcloud run jobs add-iam-policy-binding convolve-run-due-bots --project=$P --region=$R \
  --member=serviceAccount:convolve-scheduler@$P.iam.gserviceaccount.com --role=roles/run.invoker
gcloud scheduler jobs update http convolve-daily-run --project=$P --location=$R \
  --schedule="*/15 * * * *" --time-zone=Etc/UTC --http-method=POST \
  --uri="https://run.googleapis.com/v2/projects/$P/locations/$R/jobs/convolve-run-due-bots:run" \
  --oauth-service-account-email=convolve-scheduler@$P.iam.gserviceaccount.com \
  --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform
```

The target is a Google API, so it needs an **OAuth** token; an OIDC token is rejected.
Whoever runs the update needs `roles/iam.serviceAccountUser` on `convolve-scheduler`.

**Enabling sequence** (each step is a production change):

1. Migrate to `c5f8a3d1e290`, deploy the API and `bots-job.yaml` on one digest with both
   flags still false. Run the job once by hand; the log must show `run_due_bots_once: no-op`.
2. Fix the scheduler as above and confirm the next ticks succeed (exit code 0, `no-op`).
3. Set `LIVE_DEPLOY_ENABLED=true` and `SCHEDULED_BOTS_ENABLED=true` on the API **and** the
   job in the same change. Watch one slot: the job logs a JSON summary
   (`due`, `success`, `error`, `no_new_data`, `skipped_idempotent`, ...).

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

## Training queue, checkpoints and the optional GPU pool

**Queue (API, no new infrastructure).** `pipeline_runs` is the queue. A submitted run is
`queued` with `worker_id = job/waiting`; `trainer_jobs.pump_queue` starts waiting runs in
submission order while `TRAINER_MAX_ACTIVE_JOBS` (default 4), the per-user limit
(`TRAINER_MAX_ACTIVE_JOBS_PER_USER`, default 1) and, for GPU runs,
`TRAINER_MAX_ACTIVE_GPU_JOBS` (default 1) allow. Decisions are serialised with a Postgres
advisory lock, the `job/waiting -> job/pending` flip is conditional, and `claim()` only lets
one worker run a row, so a run never starts twice. `TRAINER_MAX_QUEUED_JOBS_PER_USER`
(default 5), `TRAINER_MAX_TRAINING_IMAGES` and `TRAINER_MAX_EPOCHS` are checked before the
run is registered (HTTP 429). These are operational safeguards, not plan limits
(`app/plans.py: PLAN_COMPUTE_LIMITS` is empty until limits are decided).
The queue advances on submit, cancel and progress polls (throttled, lock-free when empty).
To advance it when nobody is polling, set `TRAINER_WORKER_STARTS_QUEUED=1` on the trainer
job and grant its service account `run.jobs.runWithOverrides` on the trainer job(s), plus
`TRAINER_EXECUTION=cloud_run_job` and `TRAINER_JOB_PROJECT`.

**Checkpoints and resume.** With `TRAINER_CHECKPOINTS=true` the worker saves the model with
optimizer state, best weights and early-stopping state after every epoch to
`gs://MODEL_BUCKET/checkpoints/{user}/{run}/` (state.json written last). A Cloud Run retry
(`maxRetries: 2`) of a crashed or preempted attempt continues from there; a run the worker
marked failed is never retried. Users can resume a failed or cancelled run
(`POST /trainer/runs/{id}/resume`) once its previous execution has ended. A checkpoint is
only used when run, user and a fingerprint of the configuration and data split match.
Resuming is exact with the `shards` input pipeline and approximate (same weights and
optimizer, different shuffle order) with the default `files` pipeline. A resumed run is
the same run and is not charged again.

**Optional GPU pool (off).** `TRAINER_GPU_EXECUTION=cloud_run_job|batch` plus an explicit
`TRAINER_GPU_REGION` (no default: data residency is a decision). Only runs submitted with
`accelerator="gpu"` go there; the CPU job is unchanged. Image: `Dockerfile.gpu` (same pins
plus the CUDA 12 wheels). Training stays float32: TF32 is switched off unless reduced
precision is requested. Before use, run `--check` on the GPU job and expect
`OK accelerator: GPU: NVIDIA L4`.

**Benchmark kit (not executed; needs approval, about USD 1-3 in total).** Uses a ZIP of
public-market charts made with the chart generator, never customer data:
```bash
gcloud storage cp charts.zip gs://$STAGING_BUCKET/bench/charts.zip
# Separate job, same image and resources as the production trainer; no database access.
gcloud run jobs create convolve-bench-cpu --region=europe-west6 --image=$IMAGE \
  --cpu=8 --memory=8Gi --max-retries=0 --task-timeout=3600 \
  --service-account=$TRAINER_SA --command=python \
  --args=scripts/perf/cloud_bench.py,gs://$STAGING_BUCKET/bench/charts.zip,--n,2000,--epochs,3
gcloud run jobs execute convolve-bench-cpu --region=europe-west6 --wait   # ~USD 0.03-0.05
# L4, only after the residency decision (image from Dockerfile.gpu):
gcloud run jobs create convolve-bench-l4 --region=europe-west4 --image=$GPU_IMAGE \
  --cpu=4 --memory=16Gi --gpu=1 --gpu-type=nvidia-l4 --no-gpu-zonal-redundancy \
  --max-retries=0 --task-timeout=3600 --service-account=$TRAINER_SA --command=python \
  --args=scripts/perf/cloud_bench.py,gs://$STAGING_BUCKET/bench/charts.zip,--n,2000,--epochs,3
gcloud run jobs execute convolve-bench-l4 --region=europe-west4 --wait    # ~USD 0.05-0.10
gcloud logging read 'resource.labels.job_name=~"convolve-bench" AND textPayload:"\"bench\""' --limit=50
```
Use `--epochs 30` for the full standard run (projected USD 0.10-0.20 CPU). Projected costs
per dataset size: `python scripts/perf/cost_model.py`.

**Rollback.** Everything above is configuration: `TRAINER_CHECKPOINTS=false` and
`maxRetries: 0` restore the previous worker behaviour; `TRAINER_MAX_ACTIVE_JOBS_PER_USER=0`
and `TRAINER_MAX_ACTIVE_JOBS=0` remove the limits (runs then start immediately as before);
unsetting `TRAINER_GPU_EXECUTION` hides GPU training. No migration is involved.

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

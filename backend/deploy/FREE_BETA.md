# Free beta: infrastructure runbook

Nothing here has been applied to production. Each step needs explicit approval.

## What changes

- Generator, Labeling Optimizer and test-data runs go through a durable queue in
  `pipeline_runs` (`app/services/research_jobs.py`) and run in a separate worker
  (`python -m app.jobs.research_worker`), one Cloud Run Job execution per run.
  Progress, heartbeat and cancellation live in the row, so any API instance can answer and an
  API restart does not stop a run. A worker that dies is failed once its heartbeat is stale
  (`RESEARCH_JOB_STALE_SECONDS`) and its execution has ended; its slot is released.
- Training already works this way (`convolve-trainer`).
- Backtester and Analysis Lab still compute inside the API process (instance-local state:
  `run_info.json`, in-memory registries). **Keep `maxScale=1` until they move too.**

## Environment (API service `convolve-backend-pipeline`)

```
FREE_BETA=1                       # forces BILLING_MODE=off and CREDITS_MODE=off
RESEARCH_EXECUTION=cloud_run_job
RESEARCH_JOB_NAME=convolve-research
RESEARCH_MAX_ACTIVE_JOBS=4
RESEARCH_MAX_ACTIVE_JOBS_PER_USER=1
RESEARCH_MAX_QUEUED_JOBS_PER_USER=3
RESEARCH_MAX_RUNS_PER_DAY=20
RESEARCH_JOB_MAX_RETRIES=1        # must equal the job's --max-retries
INPROCESS_MAX_ACTIVE_RUNS=2       # Backtester + Analysis on the API's 2 vCPU
INPROCESS_MAX_ACTIVE_RUNS_PER_USER=1
TRAINER_MAX_ACTIVE_JOBS=3
TRAINER_MAX_EPOCHS=30
BETA_WINDOW_START=2026-10-31T00:00:00Z   # founding-member window opens (ISO 8601, UTC)
MARKET_DATA_ACCESS=cohort         # Yahoo-powered tools for the invited group only
MARKET_DATA_COHORT=<uuid>,<uuid>  # Supabase account ids of the test group
```

`MARKET_DATA_ACCESS=cohort` limits Generator (runs, estimates, previews, symbol search),
Labeling Optimizer, test data, Backtester and paper bots (new, resumed, manual and scheduled
runs) to `MARKET_DATA_COHORT`, until a market-data licence covers public use. Set the same two
variables on the bots job. `MARKET_DATA_ACCESS=open` lifts the restriction without a deploy of
new code.

Service settings: container concurrency 1 → 20 (heavy work no longer runs in requests),
maxScale stays 1.

## Research job (same image as the API and trainer)

```
gcloud run jobs create convolve-research \
  --region=europe-west6 --image=<current backend image> \
  --command=python --args=-m,app.jobs.research_worker \
  --cpu=2 --memory=4Gi --task-timeout=3600 --max-retries=1 \
  --service-account=<trainer job service account> \
  --set-secrets=DATABASE_URL=<same secret as the trainer job> \
  --set-env-vars=APP_PROFILE=cloud,MODEL_BUCKET=<bucket>,RESEARCH_EXECUTION=cloud_run_job,RESEARCH_JOB_NAME=convolve-research,RESEARCH_JOB_PROJECT=<project>,RESEARCH_JOB_REGION=europe-west6
```

The API's service account needs `run.jobs.runWithOverrides` (and `run.executions.get/cancel`)
on `convolve-research`, as it already has on `convolve-trainer`. Finishing workers start the
next queued run themselves; the same permission on the job's account lets them do that,
otherwise the queue moves on the next status poll.

## Rollback

`RESEARCH_EXECUTION=inprocess` restores the previous behaviour; queued rows from the job mode
are failed by nothing automatically, so drain the queue first (no `job/waiting` rows).
`FREE_BETA` unset restores the configured billing modes.

## Local equivalent

`RESEARCH_EXECUTION=local_process` runs each worker as a detached, lower-priority process on the
same machine (no extra infrastructure).

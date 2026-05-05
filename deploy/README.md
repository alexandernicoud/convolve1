# Hetzner Deployment

## Server setup

1) SSH into the server:
```
ssh root@88.99.188.197
```

2) Install Docker:
```
curl -fsSL https://get.docker.com | sh
```

3) Clone or pull the repo:
```
git clone <YOUR_REPO_URL>
cd convolve-broken\ frontend
git pull
```

4) Create the env file:
```
cp deploy/env.example deploy/.env
```

5) Start the stack:
```
cd deploy
docker compose up -d --build
```

API will be available on `http://88.99.188.197:8001`.

FROM node:20-bookworm-slim

# curl, jq, bash: not needed by the app itself, but this way the SAME
# container that runs the server can also run jopup-e2e-test.sh directly
# (via `docker compose exec backend bash`), with no separate test image and
# none of the Windows-side bash/jq installation issues from earlier in this
# setup.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl jq bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifest first so `npm install` is cached across rebuilds unless
# package.json/package-lock.json actually change.
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]

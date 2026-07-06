## About Webwow

Webwow is a no-code platform that combines a visual HTML editor with a dynamic CMS running on [ycode][ycode-repo]. 
It serves as an open-source and selfhost Webflow alternative featuring a seamless migration assistant.

## Quick Start

Webwow ships as a plug-and-play [Docker](https://docs.docker.com/get-docker/) image: ```docker pull html67/webwow:latest```

## Installation
### Option 1: Docker

Download this repository, then:

```bash
docker compose up -d
```
The builder is now available at [http://localhost:3002](http://localhost:3002).

Updating to a new version:

```bash
docker compose pull && docker compose up -d       # prebuilt image
docker compose up -d --build                      # built from source
```
### Option 2: Development Setup

If you want to work on the code directly, you need Node.js 20+ and a running PostgreSQL instance:

```bash
cp .env.example .env    # set DATABASE_URL, ADMIN_PASSWORD, PAGE_AUTH_SECRET
npm ci
npm run migrate:latest
npm run dev             # starts on http://localhost:3002
```

### Configuration

The defaults in `docker-compose.yml` are meant for local use. **Before exposing Webwow to the internet, change at least these two values** in the `app` service:

| Variable | Purpose | Default |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Login password for the builder (empty = login disabled) | `changeme` |
| `PAGE_AUTH_SECRET` | Secret for signing auth cookies — generate with `openssl rand -hex 32` | placeholder |
| `DATABASE_URL` | PostgreSQL connection string | points to the bundled `db` service |
| `UPLOAD_DIR` | Directory for uploaded assets | `/app/uploads` (Docker volume) |

Uploads and the database are persisted in the named volumes `uploads` and `postgres_data`, so your data survives updates and container rebuilds.

## Features
- yCode depends on GitHub, Supabase, and Vercel accounts. Webwow removes all of these dependencies: everything runs locally via Docker with a bundled PostgreSQL database and local file storage.
- UI adjustments to align the editor with user habits from popular editors.
- Migration Assistant

### Working on
Its goal is to create open formats and make websites accessible — fully self-hosted, with no external services required.

- [Medusa.js](https://medusajs.com) native shop integration
- Better component translation
- Transition from Tailwind back to native CSS
- [HTML67](https://html67.org) integration — HTML67 is part of [Project Wilhelm](https://projectwilhelm.com) by The Wilhelm Collective, a network of developers on a mission to fully democratise digitisation by 2030

## Migration Assistant

Bring existing sites into Webwow:

| Importer | Files needed |
| --- | --- |
| ycode | `export.ycode` file |
| Webflow | `webflowexport.zip` |
| Webflow CMS | `webflowexport.zip` + database CSV files + URL to live page |

### Working on

- **Universal AI Importer** — files needed: web folder or live URL
- **Shopify importer**
- **Webflow Ecommerce importer**

## Learning Webwow

Since Webwow runs on ycode, the [ycode documentation][ycode-docs] is the best reference for the builder and CMS features. Keep in mind that all hosting- and deployment-related sections (Supabase, Vercel) do not apply here — deployment is covered by the Docker setup above.

## Support

There is no official support for Webwow. The documentation linked above and the [upstream ycode repository][ycode-repo] are the best starting points. For issues specific to this project (Docker setup, importers, self-hosting), feel free to open an issue in this repository.

## Contributing

Thank you for considering contributing to Webwow! *Better put your energy into yCode ;-)*
If you really wanne contribute here review the [contribution guide][contributing] before opening issues or submitting pull requests. Improvements to the underlying builder are often better contributed [upstream to ycode][ycode-repo] so everyone benefits.

## License

Webwow is open source software licensed under the [GNU AGPL v3](https://opensource.org).

## Part of [Project Wilhelm](https://projectwilhelm.com) in collaboration with [HTML67](https://html67.org)

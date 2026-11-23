# Neurolinx IMS

Standalone welcome page for **https://neurolinx.in/IMS**.
Canonical local project: `A:\Office Projects\IMS`.

React renders the welcome page. Vite builds self-contained assets under `/IMS/` that Nginx serves without a Node.js runtime on the server.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `welcome.jsx`, `welcome.css` | HTML entry point, React page and styles |
| `Dockerfile` | Standalone Nginx image and build-commit metadata |
| `nginx.conf` | Container routes for IMS, health and version |
| `docker-compose.yml` | Git-backed Portainer stack that builds the image locally |
| `.env.example` | Image name and host-port configuration |
| `.github/workflows/ci-cd.yml` | PR checks, image publication and optional deployment |
| `scripts/check-image.sh` | Container integration checks run by CI |
| `deploy/cloudpanel-ims.conf` | CloudPanel proxy locations for the IMS container |

## 1. Push your own repository

Create an empty GitHub repository, for example `neurolinxdeveloper-0369/IMS`, and run in this folder:

```powershell
git init -b main
git add .
git commit -m "Create standalone IMS welcome project"
git remote add origin https://github.com/neurolinxdeveloper-0369/IMS.git
git push -u origin main
```

Use your actual repository URL if different. No remote repository or server stack has been created by this project setup.

A push to `main` builds the image, checks Nginx syntax and HTTP routes, then publishes the **tested image**:

```text
ghcr.io/<lowercase-owner>/<lowercase-repository>:latest
ghcr.io/<lowercase-owner>/<lowercase-repository>:sha-<full-commit>
```

For the example repository, the image is `ghcr.io/neurolinxdeveloper-0369/ims:latest`. Pull requests only validate; they cannot publish or call Portainer. Manual workflow runs publish only from `main`.

## 2. First Portainer deployment

1. Create a **new Portainer stack named `ims`** using the Repository build method, this repository's HTTPS Git URL, `refs/heads/main`, and the Compose path `docker-compose.yml`.
2. Enable GitOps updates using Polling. Portainer builds the image from its Git checkout when the tracked branch changes.
3. Set `IMS_DB_PASSWORD` to a random database password and `IMS_ADMIN_HASH` to the initial administrator's scrypt verifier. The verifier format is a 16-byte random salt in hex, a colon, and a 64-byte key derived with Node's default `scrypt` parameters in hex. Set `IMS_ADMIN_ID` to override the default administrator ID. The seed only inserts a missing account.
4. Use the default application loopback port `3060`, or set `IMS_PORT` to another available host port. PostgreSQL uses loopback host port `5440` and a persistent volume.
5. Deploy the stack and wait for the web, authentication and database containers to become healthy.

The stack binds only `127.0.0.1:<IMS_PORT>`. CloudPanel on the same server provides public HTTPS. IMS has its own image and container, with no dependency on the company website or Neuro Series containers.

## 3. Connect the public IMS route

After the IMS container is healthy, open **CloudPanel → neurolinx.in → Vhost**.
Replace the existing static `/IMS` location blocks with `deploy/cloudpanel-ims.conf`, inside the current `neurolinx.in` server block. Do not append duplicate location blocks.

Change `3060` in that snippet if you chose another port. Keep `proxy_pass http://127.0.0.1:3060;` **without a trailing URI slash** so the `/IMS` prefix reaches the container. Preserve the existing site root, HTTPS settings, main website and `/neuro-series/` routes.

The earlier static welcome copy is at `/home/neurolinx/htdocs/neurolinx.in/IMS/index.html`. It was uploaded before the hosting approach changed. The container proxy takes over that route after cutover, so that static file is no longer used. Deleting it is not required for deployment.

For direct static hosting with the two existing `try_files` locations, run `npm ci` and `npm run build`, then upload the **contents** of `dist/` into the `IMS/` directory under the vhost document root. Upload `assets/` before replacing `index.html`. The app uses absolute `/IMS/assets/…` URLs, so both `/IMS` and `/IMS/` load the same bundle.

Verify:

- `https://neurolinx.in/IMS` and `https://neurolinx.in/IMS/` show the welcome page.
- `https://neurolinx.in/IMS/version.json` returns `service: neurolinx-ims`. The Portainer source build uses the `local` build marker. Check the Git commit shown in Portainer to identify the deployed revision.
- `/health` is the container's health endpoint; arbitrary application paths return 404.

## 4. Optional automatic Portainer deployment

By default, CI publishes the image and explicitly reports that automatic deployment is unconfigured. It does not assume a webhook exists or claim that the image is deployed.

If your installed Portainer edition and stack mode support an update webhook, add its HTTPS URL as the GitHub Actions repository secret **`PORTAINER_WEBHOOK_URL`**. For supported GitOps updates using a `latest` image, enable **Re-pull image** and **Force redeployment**, so an unchanged Compose file still refreshes the image. If no suitable webhook is available, re-pull and redeploy through Portainer manually.

The optional repository variable **`IMS_PUBLIC_URL`** defaults to `https://neurolinx.in/IMS`.
After a configured webhook returns successfully, CI polls `/IMS/version.json` for the exact new commit. It fails if the public route still serves an old image or the earlier static welcome. Main runs are serialized to prevent races on `latest`.

References: [Portainer webhooks](https://docs.portainer.io/user/docker/stacks/webhooks), [GitOps updates](https://docs.portainer.io/user/docker/stacks/add#gitops-updates), [GHCR package access and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

## Local preview and container checks

Run `npm ci` and `npm run dev`, then open the Vite URL at `/IMS/`. To run the container locally with Docker:

```sh
docker build --build-arg SOURCE_COMMIT=local -t neurolinx-ims:local .
docker run --rm -p 127.0.0.1:3060:80 neurolinx-ims:local
```

Open `http://127.0.0.1:3060/IMS`. On a machine with Docker, Bash, curl and jq, run the integration checks with:

```sh
bash scripts/check-image.sh neurolinx-ims:local local
```

Edit `welcome.jsx` and `welcome.css` for future page changes. The Docker build runs `npm ci` and `npm run build`.

## Inventory workspace

- Add items, vendors and projects first. A project BOM lists the required items and quantities. You can copy its lines into a vendor quotation.
- Post a purchase order from a quotation, then post one or more goods receipts against that order. The GRN adds stock and the purchase invoice copies the received lines and agreed unit prices. Current invoice matching is one invoice per GRN.
- Post opening stock before the first movement for an item. A project issue deducts stock and consumes the BOM requirement. Closing stock records an as-of snapshot and locks stock postings through that date.
- Admins create Manager and Store Person accounts from Team accounts and can reset their passwords. A temporary password must be changed at first sign-in. Managers can maintain purchasing and inventory records. Store Persons can post GRNs and stock issues without access to quotations or invoices.
- The overview, reorder indicators, stock export and activity log use recorded transactions. The workspace creates no sample records.

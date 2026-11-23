# Neurolinx IMS

Standalone welcome page for **https://neurolinx.in/inventory-management-system**.
Canonical local project: `A:\Office Projects\IMS`.

React renders the welcome page. Vite builds self-contained assets under `/inventory-management-system/` that Nginx serves without a Node.js runtime on the server.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `welcome.jsx`, `welcome.css` | HTML entry point, React page and styles |
| `Dockerfile` | Standalone Nginx image and build-commit metadata |
| `nginx.conf` | Container routes for IMS, health and version |
| `docker-compose.yml` | Separate image-only Portainer stack |
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

1. Wait for the first image publication to finish in GitHub Actions.
2. Create a **new Portainer stack named `ims`**. Use this repository's `docker-compose.yml`, or paste that file into the stack editor.
3. Set stack variables `IMS_IMAGE` to your published image and `IMS_PORT` to an available host port. The configurable default is `3060`; availability has not been checked on the server.
4. GHCR packages may be private. Configure registry authentication in Portainer for image pulls, or deliberately set the image package's visibility to public if that is your choice. Repository visibility alone does not establish package visibility. Keep credentials out of Git and Compose files.
5. Deploy the stack and wait for `neurolinx-ims` to become healthy.

The stack binds only `127.0.0.1:<IMS_PORT>`. CloudPanel on the same server provides public HTTPS. IMS has its own image and container, with no dependency on the company website or Neuro Series containers.

## 3. Connect the public IMS route

After the IMS container is healthy, open **CloudPanel → neurolinx.in → Vhost**.
Replace the existing `/IMS` location blocks with `deploy/cloudpanel-ims.conf`, inside the current `neurolinx.in` server block. Do not append duplicate location blocks.

Change `3060` in that snippet if you chose another port. Keep `proxy_pass http://127.0.0.1:3060;` **without a trailing URI slash** so the `/inventory-management-system` prefix reaches the container. Preserve the existing site root, HTTPS settings, main website and `/neuro-series/` routes.

The earlier static welcome copy is at `/home/neurolinx/htdocs/neurolinx.in/IMS/index.html`. It was uploaded before the hosting approach changed. The vhost redirects the old welcome URL to the new route after cutover. Deleting it is not required for deployment.

For direct static hosting, change both `try_files` locations and their paths from `/IMS` to `/inventory-management-system`, then run `npm ci` and `npm run build`, then upload the **contents** of `dist/` into the `inventory-management-system/` directory under the vhost document root. Upload `assets/` before replacing `index.html`. The app uses absolute `/inventory-management-system/assets/…` URLs, so both `/inventory-management-system` and `/inventory-management-system/` load the same bundle.

Verify:

- `https://neurolinx.in/inventory-management-system` and `https://neurolinx.in/inventory-management-system/` show the welcome page. The CloudPanel snippet redirects `/IMS` and `/IMS/` to the new URL.
- `https://neurolinx.in/inventory-management-system/version.json` returns `service: neurolinx-ims` and your published commit.
- `/health` is the container's health endpoint; arbitrary application paths return 404.

## 4. Optional automatic Portainer deployment

By default, CI publishes the image and explicitly reports that automatic deployment is unconfigured. It does not assume a webhook exists or claim that the image is deployed.

If your installed Portainer edition and stack mode support an update webhook, add its HTTPS URL as the GitHub Actions repository secret **`PORTAINER_WEBHOOK_URL`**. For supported GitOps updates using a `latest` image, enable **Re-pull image** and **Force redeployment**, so an unchanged Compose file still refreshes the image. If no suitable webhook is available, re-pull and redeploy through Portainer manually.

The optional repository variable **`IMS_PUBLIC_URL`** defaults to `https://neurolinx.in/inventory-management-system`.
Update any existing override to the new URL before redeploying. After a configured webhook returns successfully, CI polls `/inventory-management-system/version.json` for the exact new commit. It fails if the public route still serves an old image or the earlier static welcome. Main runs are serialized to prevent races on `latest`.

References: [Portainer webhooks](https://docs.portainer.io/user/docker/stacks/webhooks), [GitOps updates](https://docs.portainer.io/user/docker/stacks/add#gitops-updates), [GHCR package access and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

## Local preview and container checks

Run `npm ci` and `npm run dev`, then open the Vite URL at `/inventory-management-system/`. To run the container locally with Docker:

```sh
docker build --build-arg SOURCE_COMMIT=local -t neurolinx-ims:local .
docker run --rm -p 127.0.0.1:3060:80 neurolinx-ims:local
```

Open `http://127.0.0.1:3060/inventory-management-system`. On a machine with Docker, Bash, curl and jq, run the integration checks with:

```sh
bash scripts/check-image.sh neurolinx-ims:local local
```

Edit `welcome.jsx` and `welcome.css` for future page changes. The Docker build runs `npm ci` and `npm run build`.

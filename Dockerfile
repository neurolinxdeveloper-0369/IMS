FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.mjs welcome.jsx welcome.css ./
RUN npm run build

FROM nginx:stable-alpine

ARG SOURCE_COMMIT=local

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/inventory-management-system/

# Only a full Git commit or the local-build marker can enter the public JSON.
RUN if [ "$SOURCE_COMMIT" != "local" ]; then \
      test "${#SOURCE_COMMIT}" -eq 40 && \
      printf '%s' "$SOURCE_COMMIT" | grep -Eq '^[0-9a-fA-F]+$'; \
    fi && \
    printf '{"service":"neurolinx-ims","commit":"%s"}\n' "$SOURCE_COMMIT" > /usr/share/nginx/html/inventory-management-system/version.json

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -T 3 -O /dev/null http://127.0.0.1/health || exit 1

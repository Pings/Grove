FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# Tools hub at site root
COPY hub/ /usr/share/nginx/html/
# Grove app under /grove/
COPY --from=build /app/dist /usr/share/nginx/html/grove
EXPOSE 80

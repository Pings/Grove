FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PRICES_HOST=0.0.0.0
ENV PRICES_PORT=5050
ENV PRICES_URL_PREFIX=/prices
ENV PRICES_DB=/data/prices.db

RUN mkdir -p /data

EXPOSE 5050
CMD ["python", "-m", "price_tracker", "serve", "--host", "0.0.0.0", "--port", "5050"]

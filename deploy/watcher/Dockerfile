FROM docker:27-cli

RUN apk add --no-cache git openssh-client

COPY watch.sh /watch.sh
RUN chmod +x /watch.sh

ENTRYPOINT ["/watch.sh"]

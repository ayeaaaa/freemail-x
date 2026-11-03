# New Server SMTP Probe Deployment Design

## Goal

Verify that `<VPS_IPV4>` can receive SMTP connections on TCP port 25 before deploying the full Freemail service.

## Scope

Deploy a temporary SMTP probe only. It does not depend on Freemail, PostgreSQL, the previous server, or Cloudflare.

The probe accepts a complete SMTP transaction and writes metadata to a local log. It does not persist message bodies.

## Service

- Install location: `/opt/freemail-smtp-probe`
- Service name: `freemail-smtp-probe.service`
- Listen address: `0.0.0.0:25`
- Log file: `/var/log/freemail-smtp-probe/received.log`

## Behavior

1. An SMTP client connects and receives an SMTP `220` greeting.
2. The probe accepts `EHLO`, `MAIL FROM`, `RCPT TO`, `DATA`, and `QUIT`.
3. On a successful DATA transaction, it records timestamp, sender, recipients, subject, remote IP, and message byte count.
4. It does not write the message body, credentials, or headers other than subject.
5. It returns SMTP success only after the metadata record is written.

## Validation

1. Confirm the service listens on TCP port 25 locally.
2. Confirm an external TCP connection receives an SMTP `220` banner.
3. Complete an external SMTP test transaction.
4. Confirm a matching metadata record appears in `received.log`.
5. Confirm the service remains active after the test.

## Transition

After the port-25 probe succeeds, replace the probe with the full Freemail SMTP ingress service as part of the new Freemail deployment.

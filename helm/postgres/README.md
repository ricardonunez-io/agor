# PostgreSQL for Agor

Standalone PostgreSQL deployment. Designed to be easily replaced with RDS.

## Quick Deploy

```bash
# 1. Create secret (not in git)
kubectl create secret generic postgres-credentials \
  -n agor \
  --from-literal=username=agor \
  --from-literal=password=YOUR_PASSWORD \
  --from-literal=database-url=postgresql://agor:YOUR_PASSWORD@postgres:5432/agor

# 2. Deploy
kubectl apply -k helm/postgres/ -n agor
```

## Migrating to RDS

When ready to switch to RDS:

1. Stop the agor-daemon deployment
2. Update `postgres-credentials` secret with RDS connection details:
   ```bash
   kubectl create secret generic postgres-credentials \
     -n agor \
     --from-literal=username=agor \
     --from-literal=password=YOUR_RDS_PASSWORD \
     --from-literal=database-url=postgresql://agor:PASSWORD@your-rds-endpoint.rds.amazonaws.com:5432/agor \
     --dry-run=client -o yaml | kubectl apply -f -
   ```
3. Delete the local postgres deployment:
   ```bash
   kubectl delete -f helm/postgres/deployment.yaml -n agor
   kubectl delete -f helm/postgres/service.yaml -n agor
   ```
4. Restart agor-daemon

## Connection Details

- **Host**: `postgres` (cluster internal) or RDS endpoint
- **Port**: `5432`
- **Database**: `agor`
- **User**: from secret `postgres-credentials.username`
- **Password**: from secret `postgres-credentials.password`

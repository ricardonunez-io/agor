{{/*
Expand the name of the chart.
*/}}
{{- define "agor.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "agor.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "agor.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agor.labels" -}}
helm.sh/chart: {{ include "agor.chart" . }}
{{ include "agor.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "agor.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agor.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Daemon labels
*/}}
{{- define "agor.daemon.labels" -}}
{{ include "agor.labels" . }}
app.kubernetes.io/component: daemon
{{- end }}

{{/*
Daemon selector labels
*/}}
{{- define "agor.daemon.selectorLabels" -}}
{{ include "agor.selectorLabels" . }}
app.kubernetes.io/component: daemon
{{- end }}

{{/*
UI labels
*/}}
{{- define "agor.ui.labels" -}}
{{ include "agor.labels" . }}
app.kubernetes.io/component: ui
{{- end }}

{{/*
UI selector labels
*/}}
{{- define "agor.ui.selectorLabels" -}}
{{ include "agor.selectorLabels" . }}
app.kubernetes.io/component: ui
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "agor.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "agor.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Daemon fullname
*/}}
{{- define "agor.daemon.fullname" -}}
{{- printf "%s-daemon" (include "agor.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
UI fullname
*/}}
{{- define "agor.ui.fullname" -}}
{{- printf "%s-ui" (include "agor.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Image pull secrets
*/}}
{{- define "agor.imagePullSecrets" -}}
{{- if .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- range .Values.global.imagePullSecrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Database URL based on database type
*/}}
{{- define "agor.databaseUrl" -}}
{{- if eq .Values.database.type "sqlite" -}}
file:/home/agor/.agor/agor.db
{{- else if eq .Values.database.type "turso" -}}
{{ .Values.database.turso.url }}
{{- else if eq .Values.database.type "postgresql" -}}
{{- with .Values.database.postgresql -}}
postgresql://{{ .username }}:{{ .password }}@{{ .host }}:{{ default 5432 .port }}/{{ .database }}{{ if .sslMode }}?sslmode={{ .sslMode }}{{ end }}
{{- end -}}
{{- else -}}
file:/home/agor/.agor/agor.db
{{- end -}}
{{- end }}

{{/*
Database environment variables
Returns a list of env var specs for the database configuration
*/}}
{{- define "agor.databaseEnv" -}}
{{- if eq .Values.database.type "sqlite" }}
- name: DATABASE_URL
  value: "file:/home/agor/.agor/agor.db"
{{- else if eq .Values.database.type "turso" }}
- name: DATABASE_URL
  {{- if .Values.database.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.existingSecret }}
      key: DATABASE_URL
  {{- else }}
  value: {{ .Values.database.turso.url | quote }}
  {{- end }}
{{- if or .Values.database.turso.authToken .Values.database.existingSecret }}
- name: TURSO_AUTH_TOKEN
  {{- if .Values.database.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.existingSecret }}
      key: TURSO_AUTH_TOKEN
  {{- else }}
  value: {{ .Values.database.turso.authToken | quote }}
  {{- end }}
{{- end }}
{{- else if eq .Values.database.type "postgresql" }}
- name: DATABASE_URL
  {{- if .Values.database.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.existingSecret }}
      key: DATABASE_URL
  {{- else }}
  value: {{ include "agor.databaseUrl" . | quote }}
  {{- end }}
- name: AGOR_DB_DIALECT
  value: "postgresql"
{{- end }}
{{- end }}

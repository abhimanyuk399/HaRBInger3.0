{{- define "bharat-kyc-t.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "bharat-kyc-t.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "bharat-kyc-t.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

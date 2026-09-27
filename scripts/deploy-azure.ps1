param(
    [switch]$DoDeploy,
    [string]$ResourceGroup = "habitai-rg",
    [string]$Location = "eastus",
    [string]$AcrName = "habitaiacr",
    [string]$EnvironmentName = "habitai-env",
    [string]$BackendImage = "habitaiacr.azurecr.io/backend:prod",
    [string]$MlImage = "habitaiacr.azurecr.io/ml-service:prod",
    [string]$BackendName = "habitai-backend",
    [string]$MlName = "habitai-ml",
    [string]$DatabaseUrl = "",
    [string]$AuthUrl = "",
    [string]$JwksUrl = "",
    [string]$MlServiceUrl = "https://ml.habitai.app",
    [string]$AllowedOrigins = "https://habitai.app,https://www.habitai.app",
    [string]$ApiUrl = "https://api.habitai.app",
    [string]$MlKey = "",
    [string]$GeminiKey = "",
    [string]$SmtpUser = "",
    [string]$SmtpPassword = "",
    [string]$SmtpFrom = ""
)

$ErrorActionPreference = "Stop"

function Ensure-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not installed or not on PATH."
    }
}

Ensure-Command "az"
Ensure-Command "docker"

Write-Host "=== HabitAI Azure deployment checklist ==="
Write-Host "Resource group: $ResourceGroup"
Write-Host "Location: $Location"
Write-Host "ACR: $AcrName"
Write-Host "Container App environment: $EnvironmentName"
Write-Host "Backend image: $BackendImage"
Write-Host "ML image: $MlImage"
Write-Host ""
Write-Host "This script is safe to run without -DoDeploy."
Write-Host "Use -DoDeploy to execute the Azure deployment commands below."
Write-Host ""

$commands = @(
    "az login",
    "az extension add --name containerapp --upgrade",
    "az group create --name $ResourceGroup --location $Location",
    "az acr create --resource-group $ResourceGroup --name $AcrName --sku Basic",
    "az containerapp env create --name $EnvironmentName --resource-group $ResourceGroup --location $Location",
    "az acr login --name $AcrName",
    "docker build -t $BackendImage ./backend",
    "docker push $BackendImage",
    "docker build -t $MlImage ./ml-service",
    "docker push $MlImage",
    "az containerapp create --name $BackendName --resource-group $ResourceGroup --environment $EnvironmentName --image $BackendImage --target-port 8787 --ingress external --registry-server $AcrName.azurecr.io --env-vars NODE_ENV=production PORT=8787 DATABASE_URL=\"$DatabaseUrl\" AUTH_URL=\"$AuthUrl\" JWKS_URL=\"$JwksUrl\" ALLOWED_ORIGINS=\"$AllowedOrigins\" ML_SERVICE_URL=\"$MlServiceUrl\" ML_SERVICE_API_KEY=\"$MlKey\" GEMINI_API_KEY=\"$GeminiKey\" SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=\"$SmtpUser\" SMTP_PASSWORD=\"$SmtpPassword\" SMTP_FROM=\"$SmtpFrom\"",
    "az containerapp create --name $MlName --resource-group $ResourceGroup --environment $EnvironmentName --image $MlImage --target-port 8000 --ingress external --registry-server $AcrName.azurecr.io --env-vars NODE_ENV=production ML_SERVICE_PORT=8000 ML_SERVICE_API_KEY=\"$MlKey\" ALLOWED_ORIGINS=\"$AllowedOrigins\"",
    "curl https://<backend-app-url>/health",
    "curl https://<ml-app-url>/health",
    "cd frontend; eas build --platform android --profile production"
)

foreach ($cmd in $commands) {
    Write-Host "- $cmd"
}

if (-not $DoDeploy) {
    Write-Host ""
    Write-Host "Nothing was deployed. Re-run with -DoDeploy to execute these commands."
    return
}

if (-not $DatabaseUrl) { throw "DatabaseUrl is required when -DoDeploy is used." }
if (-not $AuthUrl) { throw "AuthUrl is required when -DoDeploy is used." }
if (-not $JwksUrl) { throw "JwksUrl is required when -DoDeploy is used." }
if (-not $MlKey) { throw "MlKey is required when -DoDeploy is used." }
if (-not $SmtpUser) { throw "SmtpUser is required when -DoDeploy is used." }
if (-not $SmtpPassword) { throw "SmtpPassword is required when -DoDeploy is used." }
if (-not $SmtpFrom) { throw "SmtpFrom is required when -DoDeploy is used." }

Write-Host ""
Write-Host "Executing Azure deployment sequence..."

$commandsToRun = @(
    "az login",
    "az extension add --name containerapp --upgrade",
    "az group create --name $ResourceGroup --location $Location",
    "az acr create --resource-group $ResourceGroup --name $AcrName --sku Basic",
    "az containerapp env create --name $EnvironmentName --resource-group $ResourceGroup --location $Location",
    "az acr login --name $AcrName",
    "docker build -t $BackendImage ./backend",
    "docker push $BackendImage",
    "docker build -t $MlImage ./ml-service",
    "docker push $MlImage",
    "az containerapp create --name $BackendName --resource-group $ResourceGroup --environment $EnvironmentName --image $BackendImage --target-port 8787 --ingress external --registry-server $AcrName.azurecr.io --env-vars NODE_ENV=production PORT=8787 DATABASE_URL=\"$DatabaseUrl\" AUTH_URL=\"$AuthUrl\" JWKS_URL=\"$JwksUrl\" ALLOWED_ORIGINS=\"$AllowedOrigins\" ML_SERVICE_URL=\"$MlServiceUrl\" ML_SERVICE_API_KEY=\"$MlKey\" GEMINI_API_KEY=\"$GeminiKey\" SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=\"$SmtpUser\" SMTP_PASSWORD=\"$SmtpPassword\" SMTP_FROM=\"$SmtpFrom\"",
    "az containerapp create --name $MlName --resource-group $ResourceGroup --environment $EnvironmentName --image $MlImage --target-port 8000 --ingress external --registry-server $AcrName.azurecr.io --env-vars NODE_ENV=production ML_SERVICE_PORT=8000 ML_SERVICE_API_KEY=\"$MlKey\" ALLOWED_ORIGINS=\"$AllowedOrigins\"",
    "cd frontend; eas build --platform android --profile production"
)

foreach ($cmd in $commandsToRun) {
    Write-Host "Running: $cmd"
    Invoke-Expression $cmd
}

Write-Host "Deployment sequence complete."
Write-Host "Remember to set live HTTPS values in the app environment and verify the health endpoints."

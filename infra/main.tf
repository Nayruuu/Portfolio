locals {
  common_tags = {
    project    = "super-dev"
    env        = "api"
    managed_by = "terraform"
  }
}

module "resource_group" {
  source = "./modules/resource-group"

  name     = "rg-infra-web"
  location = var.location
  tags     = local.common_tags
}

module "cosmos_db" {
  source = "./modules/cosmos-db"

  account_name        = var.cosmos_account_name
  database_name       = "super-dev"
  location            = module.resource_group.location
  resource_group_name = module.resource_group.name
  tags                = local.common_tags
}

module "log_analytics" {
  source = "./modules/log-analytics"

  name                = "log-api"
  location            = module.resource_group.location
  resource_group_name = module.resource_group.name
  tags                = local.common_tags
}

module "container_app_environment" {
  source = "./modules/container-app-environment"

  name                       = "cae-api"
  location                   = module.resource_group.location
  resource_group_name        = module.resource_group.name
  log_analytics_workspace_id = module.log_analytics.id
  tags                       = local.common_tags
}

module "container_app" {
  source = "./modules/container-app"

  name                         = "ca-api"
  resource_group_name          = module.resource_group.name
  container_app_environment_id = module.container_app_environment.id

  cosmos_account_id    = module.cosmos_db.account_id
  cosmos_account_name  = module.cosmos_db.account_name
  cosmos_endpoint      = module.cosmos_db.endpoint
  cosmos_database_name = module.cosmos_db.database_name
  allowed_cors_origin  = var.allowed_cors_origin

  tags = local.common_tags
}

module "static_web_app" {
  source = "./modules/static-web-app"

  name                = "swa-sd-web"
  location            = "westeurope" # SWA isn't available in France Central
  resource_group_name = module.resource_group.name
  tags                = local.common_tags
  # custom_domain = "super-dev.app"  # bind once DNS points at the SWA (then add the TXT token)
}

output "swa_default_host_name" {
  description = "The Static Web App default hostname (the client is served here)."
  value       = module.static_web_app.default_host_name
}

output "api_fqdn" {
  description = "The Container App public hostname (the API base URL host)."
  value       = module.container_app.fqdn
}

output "cosmos_endpoint" {
  value = module.cosmos_db.endpoint
}

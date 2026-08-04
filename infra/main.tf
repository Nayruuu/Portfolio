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

module "storage" {
  source = "./modules/storage"

  name                = var.storage_account_name
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  tags                = local.common_tags
}

module "function_app" {
  source = "./modules/function-app"

  name                  = var.function_app_name
  resource_group_name   = module.resource_group.name
  location              = var.functions_location
  storage_blob_endpoint = module.storage.primary_blob_endpoint
  deploy_container_name = module.storage.deploy_container_name
  storage_access_key    = module.storage.primary_access_key

  app_settings = {
    "Contact__ResendApiKey" = var.resend_api_key
    "Contact__From"         = var.contact_from
    "Contact__To"           = var.contact_to
  }

  tags = local.common_tags
}

module "static_web_app" {
  source = "./modules/static-web-app"

  name                = var.static_web_app_name
  location            = "westeurope"
  resource_group_name = module.resource_group.name
  sku_tier            = "Standard"
  sku_size            = "Standard"
  tags                = local.common_tags
}

resource "azurerm_static_web_app_function_app_registration" "api" {
  static_web_app_id = module.static_web_app.id
  function_app_id   = module.function_app.id
}

resource "azurerm_consumption_budget_resource_group" "this" {
  name              = "budget-rg-infra-web"
  resource_group_id = module.resource_group.id
  amount            = var.monthly_budget_eur
  time_grain        = "Monthly"

  time_period {
    start_date = "2026-08-01T00:00:00Z"
  }

  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = [var.budget_alert_email]
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = [var.budget_alert_email]
  }
}

output "swa_default_host_name" {
  description = "The Static Web App default hostname (the client is served here)."
  value       = module.static_web_app.default_host_name
}

output "api_default_hostname" {
  description = "The Function App hostname (reached by users via the SWA /api/* proxy, not directly)."
  value       = module.function_app.default_hostname
}


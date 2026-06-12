terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  # azurerm 4.x requires an explicit subscription (or ARM_SUBSCRIPTION_ID).
  subscription_id = var.subscription_id

  # A fresh subscription only auto-registers the "core" resource providers;
  # register the ones this stack uses so it's self-contained (no manual step).
  resource_providers_to_register = [
    "Microsoft.App",                 # Container Apps
    "Microsoft.DocumentDB",          # Cosmos DB
    "Microsoft.OperationalInsights", # Log Analytics
  ]
}

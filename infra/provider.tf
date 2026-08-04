terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.20, < 5.0"
    }
  }
}

provider "azurerm" {
  features {}

  subscription_id = var.subscription_id

  resource_providers_to_register = [
    "Microsoft.Web",
    "Microsoft.Storage",
  ]
}

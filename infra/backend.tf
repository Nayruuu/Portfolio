terraform {
  backend "azurerm" {
    resource_group_name  = "rg-infra-terraform"
    storage_account_name = "stsdinfraterraform"
    container_name       = "infra-terraform"
    key                  = "terraform.tfstate"
  }
}

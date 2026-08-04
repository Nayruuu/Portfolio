resource "azurerm_service_plan" "this" {
  name                = "${var.name}-plan"
  resource_group_name = var.resource_group_name
  location            = var.location
  os_type             = "Linux"
  sku_name            = "FC1"

  tags = var.tags
}

resource "azurerm_function_app_flex_consumption" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  service_plan_id     = azurerm_service_plan.this.id

  storage_container_type      = "blobContainer"
  storage_container_endpoint  = "${var.storage_blob_endpoint}${var.deploy_container_name}"
  storage_authentication_type = "StorageAccountConnectionString"
  storage_access_key          = var.storage_access_key

  runtime_name           = "dotnet-isolated"
  runtime_version        = "10.0"
  instance_memory_in_mb  = 512
  maximum_instance_count = 1

  site_config {
    dynamic "ip_restriction" {
      for_each = var.restrict_to_front_door ? [1] : []

      content {
        name        = "front-door-only"
        action      = "Allow"
        priority    = 100
        service_tag = "AzureFrontDoor.Backend"
      }
    }
  }

  app_settings = var.app_settings

  tags = var.tags
}

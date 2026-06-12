resource "azurerm_container_app" "this" {
  name                         = var.name
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.container_app_environment_id
  revision_mode                = "Single"

  identity {
    type = "SystemAssigned"
  }

  ingress {
    external_enabled = true
    target_port      = var.target_port

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = var.max_replicas

    container {
      name   = var.name
      image  = var.image
      cpu    = var.cpu
      memory = var.memory

      # ASP.NET Core listens on target_port; ignored by the placeholder image.
      env {
        name  = "ASPNETCORE_HTTP_PORTS"
        value = tostring(var.target_port)
      }
      env {
        name  = "COSMOS__ENDPOINT"
        value = var.cosmos_endpoint
      }
      env {
        name  = "COSMOS__DATABASE"
        value = var.cosmos_database_name
      }
      env {
        name  = "CORS__ALLOWEDORIGIN"
        value = var.allowed_cors_origin
      }
    }
  }

  tags = var.tags

  lifecycle {
    # The deploy-api workflow owns the image (az containerapp update --image).
    ignore_changes = [template[0].container[0].image]
  }
}

# Cosmos DB Built-in Data Contributor (data-plane) for the app's managed identity.
resource "azurerm_cosmosdb_sql_role_assignment" "data_contributor" {
  resource_group_name = var.resource_group_name
  account_name        = var.cosmos_account_name
  role_definition_id  = "${var.cosmos_account_id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_container_app.this.identity[0].principal_id
  scope               = var.cosmos_account_id
}

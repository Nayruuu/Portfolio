resource "azurerm_cosmosdb_account" "this" {
  name                = var.account_name
  resource_group_name = var.resource_group_name
  location            = var.location

  offer_type        = "Standard"
  kind              = "GlobalDocumentDB"
  free_tier_enabled = true

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = var.location
    failover_priority = 0
  }

  tags = var.tags
}

resource "azurerm_cosmosdb_sql_database" "this" {
  name                = var.database_name
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.this.name
  throughput          = var.shared_throughput
}

# SP1 container: article view counts. Partition key = the article slug.
resource "azurerm_cosmosdb_sql_container" "article_views" {
  name                = "articleViews"
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.this.name
  database_name       = azurerm_cosmosdb_sql_database.this.name

  partition_key_paths   = ["/slug"]
  partition_key_version = 2
}

variable "subscription_id" {
  type        = string
  description = "The dedicated `super-dev` subscription id."
}

variable "location" {
  type    = string
  default = "francecentral"
}

variable "cosmos_account_name" {
  type        = string
  description = "Cosmos DB account name (globally unique, lowercase). Override if taken."
  default     = "cosmos-sd"
}

variable "allowed_cors_origin" {
  type    = string
  default = "https://super-dev.app"
}

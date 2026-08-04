variable "subscription_id" {
  type        = string
  description = "The dedicated `super-dev` subscription id."
}

variable "location" {
  type    = string
  default = "francecentral"
}

variable "functions_location" {
  type        = string
  default     = "francecentral"
  description = "Region for the Flex Consumption Function App. Move to a Flex-supported region if France Central rejects it."
}

variable "storage_account_name" {
  type        = string
  description = "Storage account backing the Function App (3-24 chars, lowercase alphanumeric, globally unique)."
  default     = "stasdapi"
}

variable "function_app_name" {
  type        = string
  description = "Function App name (globally unique — becomes <name>.azurewebsites.net)."
  default     = "afu-sd-api"
}

variable "static_web_app_name" {
  type        = string
  description = "Static Web App resource name."
  default     = "swa-sd-web"
}

variable "resend_api_key" {
  type        = string
  sensitive   = true
  description = "Resend API key (from the RESEND_API_KEY GitHub secret) — wired into Contact__ResendApiKey."

  validation {
    condition     = startswith(var.resend_api_key, "re_")
    error_message = "resend_api_key must be a Resend API key (re_…) — is the RESEND_API_KEY GitHub secret set?"
  }
}

variable "contact_from" {
  type        = string
  default     = "DoNotReply@super-dev.app"
  description = "Sender address (Contact__From) — must be on a domain verified in Resend."
}

variable "contact_to" {
  type        = string
  default     = "contact@super-dev.app"
  description = "Recipient address (Contact__To) that receives the contact-form messages."
}

variable "monthly_budget_eur" {
  type        = number
  default     = 30
  description = "Monthly cost budget for the resource group; alerts fire at 50% and 100%."
}

variable "budget_alert_email" {
  type        = string
  default     = "contact@super-dev.app"
  description = "Recipient of the budget alerts."
}

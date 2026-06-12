variable "account_name" {
  type = string
}

variable "database_name" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "shared_throughput" {
  type    = number
  default = 1000
}

variable "tags" {
  type    = map(string)
  default = {}
}

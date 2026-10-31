"""Subscriptions, credit top-ups, entitlements and cash refunds (``BILLING_MODE``).

Modules: ``catalog`` (commercial terms), ``entitlements`` (who may do what), ``lots``
(composition of the credit balance), ``money`` (refund arithmetic), ``providers`` (payment
provider adapters) and ``service`` (the operations the API calls).
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class BillingError(Exception):
    status_code = 400
    code = "billing_error"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

    def detail(self) -> Dict[str, Any]:
        return {"code": self.code, "message": self.message}


class SubscriptionRequired(BillingError):
    status_code = 403
    code = "subscription_required"

    def detail(self) -> Dict[str, Any]:
        return {**super().detail(), "plans_url": "/pricing"}


class FeatureLocked(BillingError):
    status_code = 403
    code = "feature_locked"

    def __init__(self, feature: str, required_tier: Optional[str], required_tier_name: Optional[str], message: str):
        super().__init__(message)
        self.feature = feature
        self.required_tier = required_tier
        self.required_tier_name = required_tier_name

    def detail(self) -> Dict[str, Any]:
        return {**super().detail(), "feature": self.feature, "required_tier": self.required_tier,
                "required_tier_name": self.required_tier_name, "plans_url": "/pricing"}


class QuotaExceeded(BillingError):
    status_code = 409
    code = "quota_exceeded"

    def __init__(self, quota: str, limit: int, used: int, upgrade_tier: Optional[str],
                 upgrade_tier_name: Optional[str], message: str):
        super().__init__(message)
        self.quota, self.limit, self.used = quota, limit, used
        self.upgrade_tier, self.upgrade_tier_name = upgrade_tier, upgrade_tier_name

    def detail(self) -> Dict[str, Any]:
        return {**super().detail(), "quota": self.quota, "limit": self.limit, "used": self.used,
                "upgrade_tier": self.upgrade_tier, "upgrade_tier_name": self.upgrade_tier_name}


class CountryRestricted(BillingError):
    status_code = 451
    code = "country_restricted"


class BillingConflict(BillingError):
    status_code = 409
    code = "billing_conflict"


class BillingUnavailable(BillingError):
    status_code = 503
    code = "billing_unavailable"


class PaymentFailed(BillingError):
    status_code = 402
    code = "payment_failed"

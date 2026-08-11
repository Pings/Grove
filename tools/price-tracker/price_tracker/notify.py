from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Optional


@dataclass
class GmailConfig:
    address: str
    app_password: str
    notify_to: str = ""

    @property
    def recipient(self) -> str:
        return (self.notify_to or self.address).strip()

    @property
    def configured(self) -> bool:
        return bool(self.address.strip() and self.app_password.strip() and self.recipient)


@dataclass
class AlertThresholds:
    enabled: bool = False
    drop_percent: float = 5.0
    drop_amount: float = 0.0


@dataclass
class DropAlert:
    product_name: str
    product_url: str
    currency: str
    old_price: float
    new_price: float

    @property
    def drop_amount(self) -> float:
        return self.old_price - self.new_price

    @property
    def drop_percent(self) -> float:
        if self.old_price <= 0:
            return 0.0
        return (self.drop_amount / self.old_price) * 100.0


def should_alert(alert: DropAlert, thresholds: AlertThresholds) -> bool:
    if not thresholds.enabled:
        return False
    if alert.drop_amount <= 0:
        return False
    if thresholds.drop_percent > 0 and alert.drop_percent >= thresholds.drop_percent:
        return True
    if thresholds.drop_amount > 0 and alert.drop_amount >= thresholds.drop_amount:
        return True
    return False


def send_gmail(
    config: GmailConfig,
    *,
    subject: str,
    body: str,
) -> None:
    if not config.configured:
        raise ValueError("Gmail is not configured. Add your address and app password in Settings.")

    msg = EmailMessage()
    msg["From"] = config.address.strip()
    msg["To"] = config.recipient
    msg["Subject"] = subject
    msg.set_content(body)

    context = ssl.create_default_context()
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as server:
        server.starttls(context=context)
        server.login(config.address.strip(), config.app_password.strip())
        server.send_message(msg)


def send_drop_alert(config: GmailConfig, alert: DropAlert) -> None:
    subject = (
        f"Price drop: {alert.product_name} "
        f"({alert.currency} {alert.old_price:,.2f} → {alert.currency} {alert.new_price:,.2f})"
    )
    body = (
        f"{alert.product_name} dropped in price.\n\n"
        f"Was: {alert.currency} {alert.old_price:,.2f}\n"
        f"Now: {alert.currency} {alert.new_price:,.2f}\n"
        f"Change: -{alert.currency} {alert.drop_amount:,.2f} "
        f"({alert.drop_percent:.1f}%)\n\n"
        f"{alert.product_url}\n"
    )
    send_gmail(config, subject=subject, body=body)


@dataclass
class SpecialAlert:
    product_name: str
    product_url: str
    currency: str
    price: float
    list_price: float
    discount_percent: float


def should_special_alert(
    *,
    discount_percent: Optional[float],
    threshold: float,
    enabled: bool,
) -> bool:
    if not enabled:
        return False
    if discount_percent is None:
        return False
    return discount_percent >= threshold


def send_special_alert(config: GmailConfig, alert: SpecialAlert) -> None:
    subject = (
        f"Special {alert.discount_percent:.0f}%: {alert.product_name} "
        f"({alert.currency} {alert.price:,.2f})"
    )
    body = (
        f"{alert.product_name} is on special.\n\n"
        f"Now:  {alert.currency} {alert.price:,.2f}\n"
        f"Was:  {alert.currency} {alert.list_price:,.2f}\n"
        f"Off:  {alert.discount_percent:.0f}%\n\n"
        f"{alert.product_url}\n"
    )
    send_gmail(config, subject=subject, body=body)


def send_test_email(config: GmailConfig) -> None:
    send_gmail(
        config,
        subject="Covet test email",
        body=(
            "Your Gmail settings work.\n\n"
            "You'll get messages for watch-list drops and restock specials."
        ),
    )

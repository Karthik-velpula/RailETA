import hashlib
import hmac
import html
import os
import re
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage

from sqlalchemy.orm import Session

from .models import BookingSession, BookingUser, EmailOtpChallenge, GeneralTicket

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
OTP_TTL_MINUTES = 10
MAX_OTP_ATTEMPTS = 5
_SESSION_CACHE: dict[str, tuple[int, datetime]] = {}


def _normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if not EMAIL_PATTERN.fullmatch(normalized):
        raise ValueError("Enter a valid email address.")
    return normalized


def _hash_secret(value: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(value.encode(), salt=salt.encode(), n=2**14, r=8, p=1).hex()
    return f"{salt}${digest}"


def _matches_secret(value: str, stored: str) -> bool:
    salt, digest = stored.split("$", 1)
    candidate = _hash_secret(value, salt).split("$", 1)[1]
    return hmac.compare_digest(candidate, digest)


def _send_otp(email: str, otp: str) -> None:
    host = os.getenv("SMTP_HOST")
    username = os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD")
    port = int(os.getenv("SMTP_PORT", "587"))
    sender = os.getenv("SMTP_FROM") or username
    if not all([host, username, password, sender]):
        raise RuntimeError("Email delivery is not configured. Set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM.")
    message = EmailMessage()
    message["Subject"] = "Your RailETA booking verification code"
    message["From"] = sender
    message["To"] = email
    message.set_content(f"Your RailETA verification code is {otp}. It expires in {OTP_TTL_MINUTES} minutes. Do not share this code.")
    with smtplib.SMTP(host, port, timeout=15) as client:
        client.starttls()
        client.login(username, password)
        client.send_message(message)


def _send_ticket_email(email: str, ticket: dict[str, str]) -> None:
    host = os.getenv("SMTP_HOST")
    username = os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD")
    port = int(os.getenv("SMTP_PORT", "587"))
    sender = os.getenv("SMTP_FROM") or username
    if not all([host, username, password, sender]):
        raise RuntimeError("Email delivery is not configured.")
    message = EmailMessage()
    message["Subject"] = f"RailETA demo ticket {ticket['ticketId']}"
    message["From"] = sender
    message["To"] = email
    message.set_content(
        "RAILETA AI | DEMO GENERAL TICKET\n"
        "=================================\n\n"
        f"Ticket ID: {ticket['ticketId']}\n"
        f"Issued: {ticket['issuedAtDisplay']}\n"
        f"Train: {ticket['trainId']} - {ticket['trainName']}\n"
        f"From: {ticket['boardingStation']}\n"
        f"To: {ticket['destinationStation']}\n"
        f"Scheduled departure: {ticket['scheduledDeparture']}\n"
        f"Scheduled arrival: {ticket['scheduledArrival']}\n"
        f"Journey duration: {ticket['journeyDuration']}\n"
        f"Class: {ticket['travelClass']}\n"
        f"Status: {ticket['status']}\n\n"
        "This is a RailETA prototype reservation confirmation, not an official Indian Railways ticket."
    )
    values = {key: html.escape(value) for key, value in ticket.items()}
    message.add_alternative(
        f"""<!doctype html>
<html><body style="margin:0;background:#edf5f7;color:#16324a;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#edf5f7;"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px rgba(15,48,66,.12);">
      <tr><td style="padding:28px 32px;background:linear-gradient(135deg,#062b3f,#08758a);color:#fff;">
        <div style="font-size:13px;font-weight:700;letter-spacing:2px;color:#a5f3fc;">RAILETA AI</div>
        <div style="font-size:28px;font-weight:800;margin-top:8px;">Passenger ticket receipt</div>
        <div style="font-size:13px;color:#cffafe;margin-top:8px;">Ticket ID: <strong>{values['ticketId']}</strong></div>
      </td></tr>
      <tr><td style="padding:30px 32px 12px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#4d7483;text-transform:uppercase;">Journey</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px;"><tr>
          <td style="width:45%;font-size:22px;font-weight:800;color:#0f3347;">{values['boardingStation']}</td>
          <td align="center" style="width:10%;font-size:22px;color:#0891b2;">&#8594;</td>
          <td align="right" style="width:45%;font-size:22px;font-weight:800;color:#0f3347;">{values['destinationStation']}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:12px 32px 28px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #d7e8ed;border-radius:10px;overflow:hidden;">
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#66808c;font-size:12px;">TRAIN</td><td align="right" style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#17394b;font-size:13px;font-weight:700;">{values['trainId']} · {values['trainName']}</td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#66808c;font-size:12px;">CLASS</td><td align="right" style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#17394b;font-size:13px;font-weight:700;">{values['travelClass']}</td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#66808c;font-size:12px;">DEPARTURE</td><td align="right" style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#17394b;font-size:13px;font-weight:700;">{values['scheduledDeparture']}</td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#66808c;font-size:12px;">ARRIVAL</td><td align="right" style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#17394b;font-size:13px;font-weight:700;">{values['scheduledArrival']}</td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#66808c;font-size:12px;">JOURNEY TIME</td><td align="right" style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#17394b;font-size:13px;font-weight:700;">{values['journeyDuration']}</td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#66808c;font-size:12px;">STATUS</td><td align="right" style="padding:13px 16px;border-bottom:1px solid #e4eff2;color:#087f5b;font-size:13px;font-weight:700;">{values['status']}</td></tr>
          <tr><td style="padding:13px 16px;color:#66808c;font-size:12px;">ISSUED</td><td align="right" style="padding:13px 16px;color:#17394b;font-size:13px;font-weight:700;">{values['issuedAtDisplay']}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 32px;background:#f1f9fa;border-top:1px solid #dcecef;color:#52717c;font-size:12px;line-height:18px;">This RailETA receipt is generated for prototype demonstration. It is not an official Indian Railways ticket and is not valid for travel.</td></tr>
    </table>
  </td></tr></table>
</body></html>""",
        subtype="html",
    )
    with smtplib.SMTP(host, port, timeout=15) as client:
        client.starttls()
        client.login(username, password)
        client.send_message(message)


def request_otp(session: Session, email: str) -> tuple[dict, str, str]:
    email = _normalize_email(email)
    if session.query(BookingUser).filter_by(email=email).one_or_none():
        raise ValueError("An account already exists for this email. Use sign in to continue.")
    otp = f"{secrets.randbelow(1_000_000):06d}"
    challenge = session.query(EmailOtpChallenge).filter_by(email=email).one_or_none()
    if challenge is None:
        challenge = EmailOtpChallenge(email=email, otp_hash=_hash_secret(otp), expires_at=datetime.utcnow() + timedelta(minutes=OTP_TTL_MINUTES))
        session.add(challenge)
    else:
        challenge.otp_hash = _hash_secret(otp)
        challenge.expires_at = datetime.utcnow() + timedelta(minutes=OTP_TTL_MINUTES)
        challenge.attempts = 0
        challenge.verified = False
    # Commit the challenge before SMTP work begins. The caller queues delivery
    # after the response, so a slow mail server never blocks passenger sign-in.
    session.flush()
    return ({"message": "Verification code is on its way to your email.", "expiresInMinutes": OTP_TTL_MINUTES}, email, otp)


def verify_otp(session: Session, email: str, otp: str) -> dict:
    email = _normalize_email(email)
    challenge = session.query(EmailOtpChallenge).filter_by(email=email).one_or_none()
    if not challenge or challenge.expires_at < datetime.utcnow():
        raise ValueError("This verification code has expired. Request a new code.")
    if challenge.attempts >= MAX_OTP_ATTEMPTS:
        raise ValueError("Too many incorrect attempts. Request a new code.")
    challenge.attempts += 1
    if not _matches_secret(otp.strip(), challenge.otp_hash):
        raise ValueError("Incorrect verification code.")
    challenge.verified = True
    return {"message": "Email verified."}


def create_password(session: Session, email: str, password: str) -> dict:
    email = _normalize_email(email)
    if len(password) < 8:
        raise ValueError("Password must contain at least 8 characters.")
    challenge = session.query(EmailOtpChallenge).filter_by(email=email).one_or_none()
    if not challenge or not challenge.verified or challenge.expires_at < datetime.utcnow():
        raise ValueError("Verify your email before creating a password.")
    if session.query(BookingUser).filter_by(email=email).one_or_none():
        raise ValueError("An account already exists for this email.")
    session.add(BookingUser(email=email, password_hash=_hash_secret(password)))
    session.delete(challenge)
    return {"message": "Account created. Sign in to continue with booking."}


def account_status(session: Session, email: str) -> dict:
    email = _normalize_email(email)
    return {"exists": bool(session.query(BookingUser).filter_by(email=email).one_or_none())}


def sign_in(session: Session, email: str, password: str) -> dict:
    email = _normalize_email(email)
    user = session.query(BookingUser).filter_by(email=email).one_or_none()
    if not user or not _matches_secret(password, user.password_hash):
        raise ValueError("Incorrect email or password.")
    raw_token = secrets.token_urlsafe(32)
    session.add(BookingSession(
        user_id=user.id,
        token_hash=_hash_secret(raw_token),
        expires_at=datetime.utcnow() + timedelta(hours=1),
    ))
    _SESSION_CACHE[raw_token] = (user.id, datetime.utcnow() + timedelta(hours=1))
    return {"sessionToken": raw_token, "message": "Signed in for booking."}


def create_general_ticket(session: Session, session_token: str, train_id: str, train_name: str, boarding_station: str, destination_station: str, scheduled_departure: str | None = None, scheduled_arrival: str | None = None, journey_duration: str | None = None) -> tuple[dict, str, dict[str, str]]:
    boarding = boarding_station.strip()
    destination = destination_station.strip()
    if not all([train_id.strip(), train_name.strip(), boarding, destination]):
        raise ValueError("Train, boarding station, and destination station are required.")
    if boarding.lower() == destination.lower():
        raise ValueError("Boarding station and destination station must be different.")
    cached = _SESSION_CACHE.get(session_token)
    if cached and cached[1] > datetime.utcnow():
        user = session.get(BookingUser, cached[0])
    else:
        _SESSION_CACHE.pop(session_token, None)
        active_sessions = session.query(BookingSession).filter(BookingSession.expires_at > datetime.utcnow()).all()
        active_session = next((item for item in active_sessions if _matches_secret(session_token, item.token_hash)), None)
        user = session.get(BookingUser, active_session.user_id) if active_session else None
    if not user:
        raise ValueError("Booking account was not found.")
    ticket = GeneralTicket(
        booking_reference=f"RETA-{datetime.utcnow():%y%m%d}-{secrets.token_hex(3).upper()}",
        user_id=user.id,
        train_id=train_id.strip(),
        train_name=train_name.strip(),
        boarding_station=boarding,
        destination_station=destination,
        scheduled_departure=scheduled_departure or "Scheduled time unavailable",
        scheduled_arrival=scheduled_arrival or "Scheduled time unavailable",
        journey_duration=journey_duration or "Duration unavailable",
    )
    session.add(ticket)
    session.flush()
    receipt = {
        "ticketId": ticket.booking_reference,
        "reference": ticket.booking_reference,
        "trainId": ticket.train_id,
        "trainName": ticket.train_name,
        "boardingStation": ticket.boarding_station,
        "destinationStation": ticket.destination_station,
        "scheduledDeparture": ticket.scheduled_departure,
        "scheduledArrival": ticket.scheduled_arrival,
        "journeyDuration": ticket.journey_duration,
        "travelClass": ticket.travel_class,
        "status": ticket.status,
        "issuedAt": ticket.created_at.isoformat(),
        "issuedAtDisplay": ticket.created_at.strftime("%d %b %Y, %I:%M %p UTC"),
    }
    return ({
        "message": "Demo general ticket confirmed. Your ticket receipt is being sent to your email.",
        "ticket": receipt,
    }, user.email, receipt)

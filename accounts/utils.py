import secrets

# No 0/O, 1/I/L, to avoid confusion when typing
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8


def generate_join_code():
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def sign_out_everywhere(user):
    """Cancel every refresh token the user has, so all their logged-in devices
    are signed out (each device's short access token still works for up to 15 minutes)."""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)

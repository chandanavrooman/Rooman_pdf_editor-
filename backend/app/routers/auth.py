import secrets

from fastapi import APIRouter

from ..core.deps import CurrentUser, SettingsDep, StoreDep
from ..core.errors import AppError
from ..core.security import create_access_token, hash_password, verify_password
from ..schemas.auth import Credentials, RegisterRequest, TokenResponse, UserOut
from ..services.storage import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

# verified against when the email is unknown, to keep response time similar
_DUMMY_HASH = hash_password("dummy-password-for-timing")


def _token(user: User, settings) -> TokenResponse:
    token, exp = create_access_token(user.id, settings)
    return TokenResponse(access_token=token, expires_in=exp, user=UserOut(id=user.id, email=user.email, name=user.name))


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(body: RegisterRequest, store: StoreDep, settings: SettingsDep):
    if not settings.allow_registration:
        raise AppError(403, "REGISTRATION_DISABLED", "Registration is disabled")
    user = store.create_user(body.email, body.name.strip(), hash_password(body.password))
    return _token(user, settings)


@router.post("/login", response_model=TokenResponse)
def login(body: Credentials, store: StoreDep, settings: SettingsDep):
    user = store.get_user_by_email(body.email)
    ok = verify_password(user.password_hash if user else _DUMMY_HASH, body.password)
    if not user or not ok:
        raise AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password")
    return _token(user, settings)


LOCAL_TEST_EMAIL = "local-test@rooman.local"


@router.post("/local-session", response_model=TokenResponse, summary="Local testing only: session without sign-in")
def local_session(store: StoreDep, settings: SettingsDep):
    """Issues a normal token for one fixed local user when LOCAL_TEST_MODE is on and ENV=development.

    Everything downstream (ownership checks, per-user storage, MCP user tokens) works unchanged; only the
    sign-in step is skipped. Returns 404 otherwise, so the endpoint does not exist in production.
    """
    if not settings.local_test_mode_active:
        raise AppError(404, "NOT_FOUND", "Not found")
    user = store.get_user_by_email(LOCAL_TEST_EMAIL)
    if user is None:
        # random password hash: nobody can sign in to this account with a password
        user = store.create_user(LOCAL_TEST_EMAIL, "Local tester", hash_password(secrets.token_urlsafe(32)))
    return _token(user, settings)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return UserOut(id=user.id, email=user.email, name=user.name)

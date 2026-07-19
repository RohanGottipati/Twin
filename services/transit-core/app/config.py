from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "TechTO Transit Core"
    env: str = "development"
    timezone: str = "America/Toronto"
    next_proxy_base: str = "http://localhost:3000"


settings = Settings()

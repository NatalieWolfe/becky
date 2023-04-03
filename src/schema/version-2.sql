
CREATE TABLE IF NOT EXISTS weather_hourly_forecast (
  location_id   VARCHAR(32) NOT NULL REFERENCES locations (location_id),
  forecast_time DATETIME NOT NULL,
  forecast      TEXT NOT NULL,
  temperature   REAL NOT NULL,
  rain_mm       REAL NOT NULL,
  snow_mm       REAL NOT NULL,
  PRIMARY KEY (location_id, forecast_time ASC) ON CONFLICT ABORT
);

UPDATE becky_schema SET version = 2 WHERE TRUE;


CREATE TABLE IF NOT EXISTS weather_hourly_forecast (
  location_id   VARCHAR(32) NOT NULL REFERENCES locations (location_id),
  forecast_time TIMESTAMP NOT NULL,
  forecast      JSON NOT NULL,
  temperature   DOUBLE PRECISION NOT NULL,
  rain_mm       DOUBLE PRECISION NOT NULL,
  snow_mm       DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (location_id, forecast_time)
);

CREATE INDEX IF NOT EXISTS ordered_weather_hourly_forecast
ON weather_hourly_forecast (
  location_id,
  forecast_time ASC
);

UPDATE becky_schema SET version = 2 WHERE TRUE;


CREATE TABLE IF NOT EXISTS locations (
  location_id VARCHAR(32) NOT NULL PRIMARY KEY,
  name        VARCHAR(128) NOT NULL UNIQUE,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  UNIQUE (lat, lon)
);

CREATE TABLE IF NOT EXISTS weather_hourly_history (
  location_id   VARCHAR(32) NOT NULL REFERENCES locations (location_id),
  weather_time  TIMESTAMP NOT NULL,
  weather       JSON NOT NULL,
  temperature   DOUBLE PRECISION NOT NULL,
  rain_mm       DOUBLE PRECISION NOT NULL,
  snow_mm       DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (location_id, weather_time)
);

CREATE INDEX IF NOT EXISTS ordered_weather_hourly_history
ON weather_hourly_history (
  location_id,
  weather_time DESC
);

CREATE TABLE becky_schema AS SELECT 1 AS version;

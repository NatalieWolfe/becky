
CREATE TABLE IF NOT EXISTS locations (
  location_id VARCHAR(32) NOT NULL PRIMARY KEY,
  name        VARCHAR(128) NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  UNIQUE (lat, lon) ON CONFLICT ABORT
);

CREATE TABLE IF NOT EXISTS weather_hourly_history (
  location_id   VARCHAR(32) NOT NULL REFERENCES locations (location_id),
  weather_time  DATETIME NOT NULL,
  weather       TEXT NOT NULL,
  temperature   REAL NOT NULL,
  rain_mm       REAL NOT NULL,
  snow_mm       REAL NOT NULL,
  PRIMARY KEY (location_id, weather_time) ON CONFLICT ABORT
);

CREATE INDEX IF NOT EXISTS ordered_weather_hourly_history
ON weather_hourly_history (
  location_id,
  weather_time DESC
);

CREATE TABLE becky_schema AS SELECT 1 AS version;

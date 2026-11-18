-- Runs once, when the container's data volume is first created (ADR 0005).
-- Tests migrate and truncate this database; they never touch bftm_dev.
CREATE DATABASE bftm_test;

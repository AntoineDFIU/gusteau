#!/bin/sh
set -eu
LABEL=com.jpdodel.gusteau.nemotron-asr
launchctl bootout "gui/$(id -u)/$LABEL"

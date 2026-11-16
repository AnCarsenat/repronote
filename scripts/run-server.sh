#!/bin/bash

npm run serve &
sleep 2
librewolf "http://localhost:4173/"

# spiff
My own interface for playing [SpaceTraders](https://spacetraders.io/).

I don't currently have the interface hosted anywhere.

Browser testing performed exclusively on modern Firefox.
Other browsers may or may not work properly.

Spiff requires running a server. Space Traders involves automation, but the automation happens
client-side, which means that it stops if the client isn't running.

I want to play on my laptop, but I don't want to leave my laptop running all the time.
So I am going to run a server that interfaces with the SpaceTraders servers and then have my web
app interface with my server.

The server can be started by running `npm run start`.
This will run the server at `127.0.0.1:8080` by default, which can be changed by instead running
`npm run start -- --host=localhost --port=1234`.

Argument List:

 - `--host` The hostname to service requests on.
 - `--port` The port number to service requests on.

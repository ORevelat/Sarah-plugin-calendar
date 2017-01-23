var fs         = require('fs');
var readline   = require('readline');
var google     = require('googleapis');
var googleAuth = require('google-auth-library');

var rfc_3339   	  = 'YYYY-MM-DD[T]HH:mm:ssZ';
var rfc_3339_date = 'YYYY-MM-DD';
var moment     = require('moment');

var words = require( './calendar.json' );

moment.locale('fr');

exports.init = function() {
	console.log('\x1b[96mCalendar plugin is initializing ... \x1b[0m');
	authorize(function(auth){ /*  NONE  */ });
};

exports.dispose  = function() {
	console.log('\x1b[96mCalendar plugin is disposed ... \x1b[0m');
};

exports.cron = function(next){
  actionPlanning({}, next);
}

exports.action = function(data, next) {
	if ( data.mode && (data.mode == "CALENDAR"))
		return actionCalendar(data, next);

	commandError(next);
};

var commandError = function(next) {
	var toSpeak = '';
	var availableTTS = words["command_error"];
	if (Object.keys(availableTTS).length > 0) {
		var choice = Math.floor(Math.random() * Object.keys(availableTTS).length); 
		toSpeak = availableTTS[choice];
	}

	next({'tts': toSpeak});
};

var actionCalendar = function (data, next) {
	console.log('\x1b[91mmode=CALENDAR \x1b[0m');

	if (data.cmd == "PLANNING")
		return actionPlanning(data, next);

	commandError(next);
};

var actionPlanning = function (data, next) {
	var pluginProps = Config.modules.calendar;

	authorize(function(auth) { 

		listEvents(auth, pluginProps.calendar_id, function(events) {
			if (!events) return next();

			// Next 5 minutes OR today OR next day
			var start  = new moment();
			var end    = new moment(start).add(5, 'minutes');
			if (data.check == 'today') {
				end   = new moment(start).set('hour', 23).set('minute', 59).set('second', 59);
			}
			else if (data.check == 'tomorrow') {
				start = start.add(1, 'day').set('hour', 0).set('minute', 0).set('second', 0);
				end   = new moment(start).set('hour', 23).set('minute', 59).set('second', 59);
			}

			// Filter date/time
			var events = events.filter(function(event) {
				var begin;
				if (data.check && data.check != 'next' && event.start.date)
					begin = new moment(event.start.date, rfc_3339_date);
				else 
					begin = new moment(event.start.dateTime, rfc_3339);

				if (data.check != 'tomorrow' && !event.reminders.useDefault && event.reminders.overrides) {
					begin = begin.subtract(event.reminders.overrides[0].minutes, 'minutes');
				}

				if (data.check && data.check != 'next' && event.start.date)
					return begin.isSame(start, 'year') && begin.isSame(start, 'month') && begin.isSame(start, 'day') ? event : undefined;
				else
					return begin.isBetween(start, end) ? event : undefined;
			});

			// Build TTS
			var tts = "";
			events.map(function(event) { 
				var horodatage = '';
				if (event.start.date) {
					var begin = new moment(event.start.date, rfc_3339_date);
					horodatage = toDay(begin.day()) + ' : ';
				}
				else {
					var begin = new moment(event.start.dateTime, rfc_3339);
					var minutes = begin.format("mm");
					horodatage = 'à ' + begin.format("HH") + ' heure ' + ((minutes != '00') ? minutes : '') + ': ';
				}

				if (event.summary)
					tts +=  horodatage + event.summary + '.       ';
			});

			if (tts.length == 0 && data.check) {
				if (data.check == 'next')
					tts = 'rien dans l\'immédiat';
				else if (data.check == 'today')
					tts = 'rien de prévu pour le moment';
				else if (data.check == 'tomorrow')
					tts = 'le planning de demain est vide pour me moment';
			}

			next({ "events": events, "tts": tts });
		});

	});
};


function toDay(day) {
	var days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
	return days[day];
};

// GOOGLE API specific

var SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

function authorize(callback) {
	var pluginProps = Config.modules.calendar;

	var clientSecret = pluginProps.calendar_secret;
	var clientId = pluginProps.calendar_clientid;
	var redirectUrl = pluginProps.calendar_redirect_uris;
	var auth = new googleAuth();
	var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

	// Check if we have previously stored a token.
	if (!pluginProps.calendar_expiry_date) {
		getNewToken(oauth2Client, callback);
	} else {
		oauth2Client.credentials = {
			"access_token"  : pluginProps.calendar_access_token,
			"token_type"    : pluginProps.calendar_token_type  ,
			"refresh_token" : pluginProps.calendar_refresh_token,
			"expiry_date"   : pluginProps.calendar_expiry_date 
		};
		callback(oauth2Client);
	}
};

function getNewToken(oauth2Client, callback) {
	var authUrl = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: SCOPES
	});
	warn('>>> Authorize this app by visiting this url: ', authUrl);
	var rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	rl.question('>>> Enter the code from that page here: ', function(code) {
		rl.close();
		oauth2Client.getToken(code, function(err, token) {
			if (err) {
				info('Error while trying to retrieve access token', err);
				return;
			}
			oauth2Client.credentials = token;
			storeToken(token);
			callback(oauth2Client);
		});
	});
};

function storeToken(token) {
	var pluginProps = Config.modules.calendar;

	pluginProps.calendar_access_token  = token.access_token;
	pluginProps.calendar_token_type    = token.token_type;
	pluginProps.calendar_refresh_token = token.refresh_token;
	pluginProps.calendar_expiry_date   = token.expiry_date;

	SARAH.ConfigManager.save();
	info('Token stored in properties');
};

var listEvents = function(auth, calendar_id, callback) {
	var calendar = google.calendar('v3');
	calendar.events.list({
		auth: auth,
		calendarId: calendar_id,
		timeMin: (new Date()).toISOString(),
		maxResults: 10,
		singleEvents: true,
		orderBy: 'startTime'
	}, function(err, response) {
		if (err) {
			info('The API returned an error: ' + err);
			return callback();
		}

		var events = response.items;
		if (events.length == 0) {
			info('No upcoming events found.');
		}
		callback(events);
	});
};

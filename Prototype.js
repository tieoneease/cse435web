const lengthOfCanvasInMeters = 50; // meters
const heightOfCanvasInMeters = 20; // meters
const canvasWidth = 1000; // pixels
const framesPerSecond = 100; // frames in a second
const metersPerPixel = lengthOfCanvasInMeters / canvasWidth; // how many meters each pixel is equivalent to
const pixelsPerMeter = canvasWidth / lengthOfCanvasInMeters; // how many pixels each meter is equivalent to
const tickRate = 1000 / framesPerSecond; // ms/frame

const carWidth = 5; // meters
const carHeight = 2; // meters

const pedestrianDiameter = .5; // meters
const pedestrianLocationAccuracy = .5; // meters
const pedestrianSpeedAccuracy = .2; // m/s
const pedestrianDirectionAccuracy = 5; // Degrees
const maxPedestrianVel = 10; // m/s
const bufferZone = .5; // meters

const brakeByWireAccuracy = .02; // Percent
var timeToReachDecel = .2; // s
const releaseTime = .1; // s
const maxDecel = -6.867 * .98; // m/s/s, multiply by .98 because the deceleration has a variance of 2%. We assume worst case scenario to avoid pedestrian so subtract 2%.
const maxAccel = 2.4525 // m/s/s
var steadyStateSpeed = 13.9; // m/s

var requestedDecel = 0;
var requestedAccel = 0;

var time; // Keeps track of how long the simulation has been running
var theoreticalTimeToComplete; // The best possible time the car could complete the simulation
var timeStopped = 0;

var canvas;
var canvasContext;

var pedestrianX; // Text input
var pedestrianY; // Text input
var pedestrianVel; // Text input
var carSpeed; // Label

window.onload = function () {
    var lengthOfCanvas = document.getElementById("lengthOfSimulation");
    lengthOfCanvas.textContent = "The length of the simulation is " + lengthOfCanvasInMeters + " meters"; // Display correct length
    var heightOfCanvas = document.getElementById("heightOfSimulation");
    heightOfCanvas.textContent = "The height of the simulation is " + heightOfCanvasInMeters + " meters"; // Display correct height

    // Setup the HTML5 canvas
    canvas = document.getElementById("sbCanvas");
    canvas.height = heightOfCanvasInMeters * pixelsPerMeter;
    canvas.width = canvasWidth;

    // Setup the context and draw the background
    canvasContext = canvas.getContext("2d");
    drawBackground();

    // Store commonly used text inputs as variables for easier access
    pedestrianX = document.getElementById("personX");
    pedestrianY = document.getElementById("personY");
    pedestrianVel = document.getElementById("personVel");
    carSpeed = document.getElementById("carSpeed");
}

// Easier passage of data to return from functions. Could be anonymized.
var pair = function () {
    var self = this;
    self.min = 0;
    self.max = 0;
    self.xDist = 0;
}

// Easier passage of data to return from functions. Could be anonymized.
var personDto = function () {
    var self = this;
    self.xPos;
    self.yPos;
    self.yVel;
}

// Base 'class' for person and car classes since each of those only moves in one direction
// x/y could be eliminated and just have pos/vel/accel
var sbObject = function () {
    var self = this;
    self.xPos = 0;
    self.yPos = 0;
    self.xVel = 0;
    self.yVel = 0;
    self.xAccel = 0;
    self.yAccel = 0;

    self.setPosition = function (xpos, ypos) {
        self.xPos = +xpos; // meters
        self.yPos = +ypos;
    }

    self.setVelocity = function (xvel, yvel) {
        self.xVel = +xvel; // meters/second
        self.yVel = +yvel;
    }

    self.setAcceleration = function (xaccel, yaccel) {
        self.xAccel = +xaccel; // meters/s/s
        self.yAccel = +yaccel;
    }
}

// Represents our pedestrian
var Person = function () {
    var self = this;
    sbObject.call(this);

    self.radius = pedestrianDiameter / 2 * pixelsPerMeter; // Pixels
    self.movingThenStop = false; // Support for scenarios in which the pedestrian starts moving then stops
    self.stopAt = 0;
    self.staticThenMoving = false; // Support for scenarios in which the pedestrian is static then moving
    self.moveAt = 0;
    self.image;

    self.draw = function () {
        canvasContext.fillStyle = 'Black';
        canvasContext.beginPath();
        canvasContext.arc(self.xPos * pixelsPerMeter, self.yPos * pixelsPerMeter, self.radius, 0, Math.PI * 2, false);
        canvasContext.fill();

        //canvasContext.drawImage(self.image, self.xPos*pixelsPerMeter-self.radius, self.yPos * pixelsPerMeter - self.radius, self.radius*2, self.radius*2);
    }

    self.initialize = function (xpos, ypos, xvel, yvel, xaccel, yaccel) {
        self.setPosition(xpos, ypos);
        self.setVelocity(xvel, yvel);
        self.setAcceleration(xaccel, yaccel);
        self.image = new Image();
        self.image.src = 'smiley.png';
    }

    self.update = function () {
        self.move();
        self.draw();
    }

    self.move = function () {
        // If we are not in one of the special scenarios, just keep moving as normal
        if (!self.movingThenStop && !self.staticThenMoving) {
            self.yPos = self.yPos + self.yVel / framesPerSecond;
        }
        else {
            // If we're moving then stopping, check to see if we're at the point we should stop at before actually moving
            if (self.movingThenStop) {
                if (self.yPos < self.stopAt) {
                    self.yPos = self.yPos + self.yVel / framesPerSecond;
                }
            }
            // If we're stopped then start moving see if the time is passed when we should start moving
            if (self.staticThenMoving) {
                if (time >= self.moveAt) {
                    self.yPos = self.yPos + self.yVel / framesPerSecond;
                }
            }
        }
    }
}

// Represents out autonomous vehicle
var Car = function () {
    var self = this;
    sbObject.call(this);

    self.width = carWidth * pixelsPerMeter; // pixels
    self.height = carHeight * pixelsPerMeter;
    self.lastDataTime; // The last time we received information about where the pedestrian was at
    self.latestData; // The position the pedestrian was at the last time we received information
    self.image;

    self.draw = function () {
        //canvasContext.fillStyle = 'Black';
        //canvasContext.fillRect(self.xPos * pixelsPerMeter, self.yPos * pixelsPerMeter, self.width, self.height);
        canvasContext.drawImage(self.image, self.xPos*pixelsPerMeter, self.yPos * pixelsPerMeter, self.width, self.height);
    }

    self.initialize = function (xpos, ypos, xvel, yvel, xaccel, yaccel) {
        self.setPosition(xpos, ypos);
        self.setVelocity(xvel, yvel);
        self.setAcceleration(xaccel, yaccel);

        // Initialize the car's information about the pedestrian
        var dto = new personDto();
        dto.xPos = person.xPos;
        dto.yPos = person.yPos;
        dto.yVel = person.yVel;

        self.latestData = dto;
        self.lastDataTime = 0;
        self.image = new Image();
        self.image.src = 'car.png';
    }

    self.update = function () {
        self.updateSpeed();
        self.move();
        self.draw();
    }

    self.move = function () {
        self.xPos = self.xPos + self.xVel / framesPerSecond;
        
        // Check to see if we're moving. If we are stopped this variable will start to increase relative to 
        // time and we can use this too see if we have stopped and the pedestrian is not moving without cheating
        if (self.xVel > 0) {
            timeStopped = time;
        }
    }

    self.setSize = function (x, y) {
        self.width = x * pixelsPerMeter;
        self.height = y * pixelsPerMeter;
    }

    self.updateSpeed = function () {
        // Check to see if its time to update our information about the pedestrian
        if (time - self.lastDataTime > .1) {
            var dto = new personDto();
            dto.xPos = person.xPos;
            dto.yPos = person.yPos;
            dto.yVel = person.yVel;

            self.latestData = dto;
            self.lastDataTime = time;
        }

        // Get the range of distances the pedestrian could occupy on the y axis
        var potentialRange = self.getPotentialRange();

        var isAccelerating = "Unchanged";

        // If we have time to brake at our current distance and speed, continue at max accel/steadystate speed OR
        // If the maximum range the pedestrian could be at is less than the position the car is at, continue OR
        // If the minimum range the pedestrian could be at is more than the position of the car (plus the collision range of the car), continue OR
        // If we have passed the pedestrian, continue
        if (self.timeToBrake() || potentialRange.max <= car.yPos || potentialRange.min >= car.yPos + carHeight || self.inTheClear()) {
            var pedestrianPosition = self.getPedestrianPosition(); // Get the min and max positions the pedestrian could be at given our tolerances

            // If at least one of the possible pedestrian positions are within the car's collision range,
            // and the distance to the pedestrian is less than the bufferzone we allow, dont continue, brake
            if (((pedestrianPosition.min > car.yPos && pedestrianPosition.min < car.yPos + carHeight) ||
                (pedestrianPosition.max > car.yPos && pedestrianPosition.max < car.yPos + carHeight)) && potentialRange.xDist < bufferZone) {

                // We don't brake instantly as there is delay for braking and for brakes to be released
                // we check to see if the value of requestedDecel is more than the time to start to decel away from the current time
                // requestedDecel is set to the current time whenever the car tries to accelerate. This is similar to the timeStopped mechanism
                if ((time - requestedDecel) > timeToReachDecel) {
                    car.xAccel = maxDecel;
                    //console.log("Decelerating because of buffer zone");
                    isAccelerating = "Decelerating";
                }
                requestedAccel = time;
            } else {

                // Same as decelerating except for accelerating
                if ((time - requestedAccel) > releaseTime) {
                    car.xAccel = maxAccel;
                    //console.log("Accelerating");
                    isAccelerating = "Accelerating";
                }
                requestedDecel = time;
            }
        }
        else {

            //Same as other deceration
            if ((time - requestedDecel) > timeToReachDecel) {
                car.xAccel = maxDecel;
                //console.log("Not safe to accelerate");
                isAccelerating = "Decelerating";
            }
            requestedAccel = time;
        }

        // If we're decerating or going under our steady state speed
        if (self.xAccel < 0 || self.xVel < steadyStateSpeed) {
            self.xVel = self.xVel + self.xAccel / framesPerSecond; // update our velocity

            //If we're going over our steady state speed return to steady state speed
            if (self.xVel > steadyStateSpeed) {
                self.xVel = steadyStateSpeed;
                self.xAccel = 0;
            }

            // If we are going backwards, set to 0 instead
            if (self.xVel <= 0) {
                self.xVel = 0;
                self.xAccel = 0;
            }
        }

        // Update text
        if (self.xVel == 0) {
            isAccelerating = "Stopped";
        }
      carSpeed.textContent = (Math.trunc(self.xVel*100)/100); 
      throttleState.textContent = isAccelerating;
    }

    // Get the min and max positions the pedestrian could be at given our tolerances
    self.getPedestrianPosition = function () {
        var returnPair = new pair();
        returnPair.min = self.latestData.yPos - person.radius * metersPerPixel - pedestrianDirectionAccuracy;
        returnPair.max = self.latestData.yPos + person.radius * metersPerPixel + pedestrianLocationAccuracy;

        return returnPair;
    }

    // Are we past the pedestrian?
    self.inTheClear = function () {
        if (car.xPos + carWidth> self.latestData.xPos + pedestrianLocationAccuracy + person.radius * metersPerPixel) {
            return true;
        }
        else {
            return false;
        }
    }

    // Do we have enough time to brake at our current speed?
    self.timeToBrake = function () {
        var xDistToPerson = self.latestData.xPos - pedestrianLocationAccuracy - person.radius * metersPerPixel - car.xPos - carWidth;
        var timeDecel = ((-1 * car.xVel) / maxDecel) + timeToReachDecel;
        var timeToReach = quadratic(car.xAccel / 2, car.xVel, xDistToPerson * -1);

        return timeDecel < timeToReach;
    }

    // Get the minimum and maximum y values, as well as the x distance to the pedestrian
    self.getPotentialRange = function () {
        // Mininum y value is y position subtracting the worst case accuracy and the person's radius
        minY = self.latestData.yPos - pedestrianLocationAccuracy - person.radius * metersPerPixel;

        // X distance to person calculated same as y. Subtract car width because the actual point the position tracks is the top left corner of the vehicle
        var xDistToPerson = self.latestData.xPos - pedestrianLocationAccuracy - person.radius * metersPerPixel - car.xPos - carWidth;

        // The time it would take to reach the person with our current acceleration, velocity, and distance to pedestrian
        // Add the time it takes to start decelerating onto this
        var timeToPerson = quadratic(car.xAccel / 2, car.xVel, xDistToPerson * -1) + timeToReachDecel;

        // The maximum y distance the pedestrian could be at is their position plus worst case accuracy and person radius, plus
        // the maximum pedestrian velocity times the time it will take the car to reach the person currently
        maxY = self.latestData.yPos + pedestrianLocationAccuracy + person.radius * metersPerPixel + (maxPedestrianVel * 1000 / 60 / 60 + pedestrianSpeedAccuracy) * timeToPerson;

        // Store relevant data in an object and return it
        var returnPair = new pair();
        returnPair.min = minY;
        returnPair.max = maxY;
        returnPair.xDist = Math.abs(xDistToPerson);

        return returnPair; // Could return anonymous object, but why?
    }
}

// Quadratic formula
function quadratic(a, b, c) {
    if (a == 0 || a == -0) {
        return Infinity;
    }
    var numerator1 = -1 * b + Math.sqrt(Math.abs(b * b - 4 * a * c));
    var numerator2 = -1 * b - Math.sqrt(Math.abs(b * b - 4 * a * c));
    var denominator = 2 * a;

    if (numerator1 > numerator2)
        return numerator1 / denominator;
    return numerator2 / denominator;
}

// Draws the background
function drawBackground() {
    canvasContext.fillStyle = 'Grey';
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw lane lines cause they're pretty
    for (j = 1; j < 3; j += 1) {
        for (i = 0; i < canvas.width; i += 130) {
            canvasContext.fillStyle = "White";
            canvasContext.fillRect(i, canvas.height / 3 * j - canvas.height / 40, 100, canvas.height / 20);
        }
    }
}

// What runs every loop
function update() {
    drawBackground();
    updateTime();
    person.update();
    car.update();

    // If we hit the pedestrian, the simulation is failed
    if (checkForCollisions(car, person)) {
        alert("Simulation Failed!\nThe collision was unavoidable!");
        return false;
    }

    // If the car is off the screen, the simulation was successful
    if (car.xPos > lengthOfCanvasInMeters) {
        alert("Simulation succeeded!\nTime lost: " + (Math.trunc((time - theoreticalTimeToComplete) * 100) / 100) + " seconds");
        return false;
    }

    // If we've been stopped for more than a second, good chance the pedestrian isn't moving.
    // Break out of the loop but give a different message since time lost doesn't mean anything in this context
    if (time - timeStopped > 1) {
        alert("Simulation succeeded!\nCollision avoided!");
        return false;
    }

    return true;
}

function updateTime() {
    document.getElementById("time").textContent = Math.trunc(time * 100) / 100 + " Seconds";
}

var isStarted = false; // Is the simulation running
var gameLoop; // Interval result

// create our car/person
var car = new Car();
var person = new Person();

// Start function linked to start button
function start() {
    // Stop the interval if its running
    clearInterval(gameLoop);

    setup();

    // Get the steady state speed and convert from kph to mps
    steadyStateSpeed = document.getElementById("carVel").value * 1000 / 60 / 60;

    // Set the time it takes to decelerate based on whether or not we're in fail mode
    if (document.getElementById("failMode").checked) {
        timeToReachDecel = .9; // s
    } else {
        timeToReachDecel = .2; // s
    }

    // The best time the simulation could complete in (going constant steady state speed)
    theoreticalTimeToComplete = (lengthOfCanvasInMeters - carWidth) / steadyStateSpeed;

    // Reset timers
    time = 0;
    requestedAccel = 0;
    requestedDecel = 0;

    // Initialize with inputted values
    person.initialize(pedestrianX.value, +pedestrianY.value + heightOfCanvasInMeters / 2, 0, pedestrianVel.value * 1000 / 60 / 60, 0, 0);
    car.initialize(+document.getElementById("carX").value - carWidth, +document.getElementById("carY").value - carHeight / 2 + heightOfCanvasInMeters / 2, steadyStateSpeed, 0, 0, 0);
    
    // Start the simulation
    gameLoop = setInterval(function () {
        isStarted = true;
        var gameState = update();
        if (!gameState) {
            isStarted = false;
            clearInterval(gameLoop);
        }
        time = time + 1 / framesPerSecond;
    }, tickRate);
}

// Check if there is a collision between the car and person
function checkForCollisions(car, person) {
    var distX = Math.abs(person.xPos * pixelsPerMeter - car.xPos * pixelsPerMeter - car.width / 2);
    var distY = Math.abs(person.yPos * pixelsPerMeter - car.yPos * pixelsPerMeter - car.height / 2);

    if (distX > (car.width / 2 + person.radius))
        return false;
    if (distY > (car.height / 2 + person.radius))
        return false;
    if (distX <= (car.width / 2))
        return true;
    if (distY <= (car.height / 2))
        return true;

    var dx = distX - car.width / 2;
    var dy = distY - car.height / 2;

    return (dx * dx + dy * dy <= (person.radius * person.radius));
}

function setup() {
    if (document.getElementById("none").checked) {
        person.movingThenStop = false;
        person.staticThenMoving = false;
    }
    else if (document.getElementById("scenario1").checked) {
        scenario1();
    } else if (document.getElementById("scenario2").checked) {
        scenario2();
    } else if (document.getElementById("scenario3").checked) {
        scenario3();
    } else if (document.getElementById("scenario4").checked) {
        scenario4();
    } else if (document.getElementById("scenario5").checked) {
        scenario5();
    } else if (document.getElementById("scenario6").checked) {
        scenario6();
    } else if (document.getElementById("scenario7").checked) {
        scenario7();
    } else if (document.getElementById("scenario8").checked) {
        scenario8();
    } else if (document.getElementById("scenario9").checked) {
        scenario9();
    } else if (document.getElementById("scenario10").checked) {
        scenario10();
    }
}

// Scenarios
function scenario1() {
    if (!isStarted) {
        person.movingThenStop = true;
        person.staticThenMoving = false;
        person.stopAt = 0 + heightOfCanvasInMeters / 2;
        pedestrianX.value = 35;
        pedestrianY.value = -7;
        pedestrianVel.value = 10;
    }
}

function scenario2() {
    if (!isStarted) {
        person.movingThenStop = true;
        person.staticThenMoving = false;
        person.stopAt = -2 + heightOfCanvasInMeters / 2;
        pedestrianX.value = 35;
        pedestrianY.value = -7;
        pedestrianVel.value = 10;
    }
}

function scenario3() {
    if (!isStarted) {
        person.movingThenStop = true;
        person.staticThenMoving = false;
        person.stopAt = -3 + heightOfCanvasInMeters / 2;
        pedestrianX.value = 35;
        pedestrianY.value = -7;
        pedestrianVel.value = 10;
    }
}

function scenario4() {
    if (!isStarted) {
        person.movingThenStop = true;
        person.staticThenMoving = false;
        person.stopAt = -5 + heightOfCanvasInMeters / 2;
        pedestrianX.value = 35;
        pedestrianY.value = -7;
        pedestrianVel.value = 10;
    }
}

function scenario5() {
    if (!isStarted) {
        person.movingThenStop = false;
        person.staticThenMoving = true;
        person.moveAt = 1.5;
        pedestrianX.value = 35;
        pedestrianY.value = 0;
        pedestrianVel.value = 10;
    }
}

function scenario6() {
    if (!isStarted) {
        person.movingThenStop = false;
        person.staticThenMoving = true;
        person.moveAt = 1.8;
        pedestrianX.value = 35;
        pedestrianY.value = -2;
        pedestrianVel.value = 10;
    }
}

function scenario7() {
    if (!isStarted) {
        person.movingThenStop = false;
        person.staticThenMoving = true;
        person.moveAt = 1.1;
        pedestrianX.value = 35;
        pedestrianY.value = -4;
        pedestrianVel.value = 10;
    }
}

function scenario8() {
    if (!isStarted) {
        person.movingThenStop = false;
        person.staticThenMoving = false;
        pedestrianX.value = 35;
        pedestrianY.value = 0;
        pedestrianVel.value = 0;
    }
}

function scenario9() {
    if (!isStarted) {
        person.movingThenStop = false;
        person.staticThenMoving = false;
        pedestrianX.value = 35;
        pedestrianY.value = -2;
        pedestrianVel.value = 0;
    }
}

function scenario10() {
    if (!isStarted) {
        person.movingThenStop = false;
        person.staticThenMoving = false;
        pedestrianX.value = 35;
        pedestrianY.value = -4;
        pedestrianVel.value = 0;
    }
}

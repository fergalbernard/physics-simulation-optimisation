// Fergal Bernard - 2022

// Get rendering context
const canvas = document.querySelector("canvas")
const ctx = canvas.getContext("2d");

// Declare global parameters
let dt = 0
let gravity = 0
let elasticity = 1
let previousTimestamp = 0
let stop = false
let startTime = performance.now()

// Analytics
const analyticsType = "energy" // averageCollisionTime or energy
let collisionType = "Grid" // Grid, SAP, or Naive
let totalEnergy
let totalEnergies = []
let collisionTimes = []
const averageCollisionTimes = []
const durationOfAnalysis = 1000

// define the neighbourhood used for Max Grid broad-phase
const neighbours = [-1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1]

// used for debugging, can be called in the animation loop to visualise the Max Grid broad-phase grid
function drawGrid(size) {
    h = canvas.height
    w = canvas.width

    for (let x = 0; x <= w; x += size) {
        for (let y = 0; y <= h; y += size) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
    }
};


// Interval class used for SAP
class Interval {
    constructor(circle, left, right, index) {
        this.circle = circle
        this.left = left
        this.right = right
        this.index = index // index of the circle in the scene elements array
    }
}

// ######################## 2D vector class and operator functions ########################

class Vector2 {
    x
    y
    constructor(x, y) {
        this.x = x
        this.y = y
    }

    setXY(x, y) {
        this.x = x
        this.y = y
    }
}

function vAdd(a, b) {
    return new Vector2(a.x + b.x, a.y + b.y)
}

function vSub(a, b) {
    return new Vector2(a.x - b.x, a.y - b.y)
}

function vMult(scalar, v) {
    return new Vector2(v.x * scalar, v.y * scalar)
}

function vMagn(a) { // calculates actual magnitude of vector
    return Math.sqrt(a.x ** 2 + a.y ** 2)
}

function vMagnF(a) { // calculates square of magnitude of vector, faster
    return a.x ** 2 + a.y ** 2
}

function vNorm(a) {
    return new Vector2(a.x / vMagn(a), a.y / vMagn(a))
}

function vDot(a, b) {
    return a.x * b.x + a.y * b.y
}
// calculates actual distance between 2 points
function distance(a, b) { 
    return vMagn(vSub(a, b))
}
// calculates square of distance between 2 points, faster
function distanceF(a, b) { 
    return vMagnF(vSub(a, b))
}

// used for collision response, returns outgoing velocity of a circle after collision with another
function compute_velocity(c1, c2) {
    const v1 = c1.velocity
    const v2 = c2.velocity
    const m1 = c1.mass
    const m2 = c2.mass
    const x1 = c1.position
    const x2 = c2.position
    const v = vMult(0.8 + 0.2 * elasticity, vSub(v1, vMult(2 * m2 / (m1 + m2) * vDot(vSub(v1, v2), vSub(x1, x2)) / vMagnF(vSub(x1, x2)), vSub(x1, x2))))
    return v
}

// ######################## Circle class ########################

class Circle {
    position
    velocity
    acceleration
    mass
    colour
    constructor(size, colour) {
        this.size = size
        this.mass = size
        this.colour = colour
        this.position = new Vector2(0, 0)
        this.velocity = new Vector2(0, 0)
        this.acceleration = new Vector2(0, gravity)
    }

    updatePos() {
        const intendedPos = new Vector2(0, 0)
        intendedPos.x = this.position.x + (this.velocity.x * dt)
        intendedPos.y = this.position.y + (this.velocity.y * dt)

        if (intendedPos.x - this.size <= 0) {
            intendedPos.x = - intendedPos.x + 2 * this.size
            this.velocity.x = Math.abs((this.velocity.x) * elasticity)
        } else if (intendedPos.x + this.size >= canvas.width) {
            intendedPos.x = 2 * canvas.width - intendedPos.x - 2 * this.size
            this.velocity.x = -Math.abs((this.velocity.x) * elasticity)
        }
        if (intendedPos.y - this.size <= 0) {
            intendedPos.y = - intendedPos.y + 2 * this.size
            this.velocity.y = Math.abs((this.velocity.y) * elasticity)
        } else if (intendedPos.y + this.size >= canvas.height) {
            intendedPos.y = 2 * canvas.height - intendedPos.y - 2 * this.size
            this.velocity.y = -Math.abs((this.velocity.y) * elasticity)
        }
        this.position = intendedPos
    }
    update() {

        this.updatePos()
        this.velocity = vAdd(this.velocity, vMult(dt, this.acceleration))

    }
    draw() {
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.colour
        ctx.fill()
        ctx.closePath()
    }
}

// ######################## Scene class ########################

class Scene {
    constructor() {
        this.elements = []
        //grid broadphase
        this.cellSize = 0
        this.cellGrid = []

    }

    add(element) {
        this.elements.push(element)
        // Updates cell size for Max Grid
        if (element.size * 2 > this.cellSize) {
            this.cellSize = element.size * 2
            this.refreshCellGrid()
        }
    }

    clear() {
        this.elements = []
        this.cellSize = 0
    }

    // used when cell size changes
    refreshCellGrid() {
        this.cellGrid = []
        for (let x = 0; x < Math.floor(canvas.width / this.cellSize + 1); x++) {
            const column = []
            for (let y = 0; y < Math.floor(canvas.height / this.cellSize + 1); y++) {
                column.push([])
            }
            this.cellGrid.push(column)
        }
    }

    // returns collision pairs using Max Grid broad-phase
    getCollisionPairsGrid() {
        const pairs = []
        // Clear grid
        for (let x = 0; x < this.cellGrid.length; x++) {
            for (let y = 0; y < this.cellGrid[x].length; y++) {
                this.cellGrid[x][y] = []
            }
        }

        // Map objects to grid
        for (let i = 0; i < this.elements.length; i++) {
            const el = this.elements[i]
            let x = Math.floor(Math.trunc(el.position.x) / this.cellSize)
            let y = Math.floor(Math.trunc(el.position.y) / this.cellSize)
            // Clamp the coordinates to grid size
            if (x >= this.cellGrid.length) {
                x = this.cellGrid.length - 1
            } else if (x < 0) {
                x = 0
            } if (y >= this.cellGrid[0].length) {
                y = this.cellGrid[0].length - 1
            } else if (y < 0) {
                y = 0
            }
            this.cellGrid[x][y].push(el)
            let others = this.cellGrid[x][y]
            let nx, ny
            const gridWidth = Math.floor(canvas.width / this.cellSize + 1)
            const gridHeight = Math.floor(canvas.height / this.cellSize + 1)
            let j = 0
            // Get neighbours
            while (j < neighbours.length) {
                nx = x + neighbours[j++]
                ny = y + neighbours[j++]
                if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
                    others = others.concat(this.cellGrid[nx][ny])
                }
            }
            // Create collision pairs using detected neighbours
            for (let k = 0; k < others.length; k++) {
                if (others[k] == el) {
                    continue //skip self
                }
                pairs.push([el, others[k]])
            }
        }
        // Narrow-phase
        const ret = []
        for (let i = 0; i < pairs.length; i++) {
            const c1 = pairs[i][0]
            const c2 = pairs[i][1]
            if (distanceF(c1.position, c2.position) <= (c1.size + c2.size) ** 2) {
                ret.push(pairs[i])
            }
        }
        return ret
    }

    // returns collision pairs using naive broad-phase
    getCollisionPairsNaive() {
        let ret = []
        for (let i = 0; i < this.elements.length; i++) {
            for (let j = i + 1; j < this.elements.length; j++) {

                const c1 = this.elements[i]
                const c2 = this.elements[j]
                if (distanceF(c1.position, c2.position) <= (c1.size + c2.size) ** 2) {
                    ret.push([c1, c2])
                }
            }
        }
        return ret
    }

    // returns collision pairs using SAP broad-phase
    getCollisionPairsSAP() {

        const xPairs = []
        const yPairs = []
        const xIntervals = []
        const yIntervals = []
        // create intervals using AABBs
        for (let i = 0; i < this.elements.length; i++) {
            const el = this.elements[i]
            const xInterval = new Interval(el, el.position.x - el.size, el.position.x + el.size, i)
            const yInterval = new Interval(el, el.position.y - el.size, el.position.y + el.size, i)
            xIntervals.push(xInterval)
            yIntervals.push(yInterval)

        }
        // sort intervals by start-point
        xIntervals.sort((a, b) => a.left - b.left)
        yIntervals.sort((a, b) => a.left - b.left)
        // find intersections along x axis
        for (let i = 0; i < xIntervals.length; i++) {
            let j = i
            for (let j = i+1; j < xIntervals.length; j++) {
                if (xIntervals[j].left > xIntervals[i].right) {
                    j = xIntervals.length
                } else {
                    // Add circle pair indices as string (hashable), always in the same order (using size)
                    if (xIntervals[i].circle.size > xIntervals[j].circle.size) {
                        xPairs.push(xIntervals[i].index.toString().concat(":", xIntervals[j].index.toString()))
                    } else {
                        xPairs.push(xIntervals[j].index.toString().concat(":", xIntervals[i].index.toString()))
                    }
                }
            }
        }
        // find instersections along y axis
        for (let i = 0; i < yIntervals.length; i++) {
            let j = i
            for (let j = i+1; j < yIntervals.length; j++) {
                if (yIntervals[j].left > yIntervals[i].right) {
                    j = xIntervals.length
                } else {
                    // Add circle pair indices as string (hashable), always in the same order (using size)
                    if (yIntervals[i].circle.size > yIntervals[j].circle.size) {
                        yPairs.push(yIntervals[i].index.toString().concat(":", yIntervals[j].index.toString()))
                    } else {
                        yPairs.push(yIntervals[j].index.toString().concat(":", yIntervals[i].index.toString()))
                    }
                }
            }
        }
        // get intersect of x and y axis sweeps
        const bPairsStr = intersect([xPairs, yPairs])
        const bPairs = []
        // convert pairs from hashable strings to pairs of circles
        for (let i = 0; i < bPairsStr.length; i++) {
            const indexes = bPairsStr[i].split(":")
            const c1 = this.elements[parseInt(indexes[0])]
            const c2 = this.elements[parseInt(indexes[1])]
            bPairs.push([c1, c2])
        }

        // Narrowphase
        const pairs = []
        for (let i = 0; i < bPairs.length; i++) {
            const c1 = bPairs[i][0]
            const c2 = bPairs[i][1]
            if (distanceF(c1.position, c2.position) <= (c1.size + c2.size) ** 2) {
                pairs.push([c1, c2])
            }
        }

        return pairs

    }

    collisions() {
        // call and time selected broad-phase
        const start = performance.now()
        let pairs
        if (collisionType === "Grid") {
            pairs = this.getCollisionPairsGrid()
        } else if (collisionType === "SAP"){
            pairs = this.getCollisionPairsSAP()
        } else {
            pairs = this.getCollisionPairsNaive()
        }
        const end = performance.now()
        collisionTimes.push(end - start)

        // collision resolution
        for (let i = 0; i < pairs.length; i++) {
            // Separate circles
            const c1 = pairs[i][0]
            const c2 = pairs[i][1]
            const d = c1.size + c2.size - distance(c2.position, c1.position)
            let v = vSub(c1.position, c2.position)
            v = vNorm(v)
            c1.position = vAdd(c1.position, vMult(d * (c2.mass / (c1.mass + c2.mass)), v))
            c2.position = vSub(c2.position, vMult(d * (c1.mass / (c2.mass + c1.mass)), v))
            // Compute velocities
            const v1 = compute_velocity(c1, c2)
            const v2 = compute_velocity(c2, c1)
            c1.velocity = v1
            c2.velocity = v2

            c1.velocity = vAdd(c1.velocity, vMult(dt, c1.acceleration))
            c2.velocity = vAdd(c2.velocity, vMult(dt, c2.acceleration))

        }
    }

    update() {
        // clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        // energy measuremnet
        totalEnergy = 0
        for (let i = 0; i < this.elements.length; i++) {
            this.elements[i].update()
            this.elements[i].draw()
            const kEnergy = vMagn(this.elements[i].velocity)**2 * (this.elements[i].mass/2)
            const pEnergy = this.elements[i].mass * vMagn(this.elements[i].acceleration) * this.elements[i].position.y
            totalEnergy += kEnergy - pEnergy
        }
        totalEnergies.push(totalEnergy)
        // process collisions
        this.collisions()
    }
}

const s = new Scene()

// Get sliders and values
const sliderDiv = document.getElementById('sliderDiv')
let sizeRange = document.getElementById('sizeSlider').value
let quantityRange = document.getElementById('quantitySlider').value
let gravityRange = document.getElementById('gravitySlider').value / 100000
let elasticityRange = elasticity = document.getElementById('elasticitySlider').value / 100
let hVelocityRange = document.getElementById('hVelocitySlider').value / 100
let vVelocityRange = document.getElementById('vVelocitySlider').value / 100
// update parameters on slider change, refresh scene
sliderDiv.onchange = function () {
    sizeRange = document.getElementById('sizeSlider').value
    quantityRange = document.getElementById('quantitySlider').value
    gravity = gravityRange = document.getElementById('gravitySlider').value / 100000
    elasticity = elasticityRange = document.getElementById('elasticitySlider').value / 100
    hVelocityRange = document.getElementById('hVelocitySlider').value / 100
    vVelocityRange = document.getElementById('vVelocitySlider').value / 100
    console.log("Size: " + sizeRange + " Quantity: " + quantityRange + " Gravity: " + gravityRange + " Elasticity: " + elasticityRange + " HVelocity: " + hVelocityRange + " VVelocity: " + vVelocityRange)
    refreshScene()
}

// used for broad-phase selection
function switchNaive() {
    console.log("Naive")
    collisionType = "Naive"
}
function switchSAP() {
    console.log("SAP")
    collisionType = "SAP"
}
function switchGrid() {
    console.log("Grid")
    collisionType = "Grid"
}

// utility function for pausing the simulation
document.addEventListener('keydown', event => {
    if (event.code === 'Space') {
        stop = true
    }
  })


function refreshScene() {
    console.log("Refreshing scene")
    // Reset analytics
    totalEnergies = []
    startTime = performance.now()
    if (collisionTimes.length > 0) {
        let averageCollisionTime = 0
        for (let i = 0; i < collisionTimes.length; i++) {
            averageCollisionTime += collisionTimes[i]
        }
        averageCollisionTime = averageCollisionTime / collisionTimes.length
        console.log("Average collision time was ", averageCollisionTime)
        averageCollisionTimes.push(averageCollisionTime)
        collisionTimes = []
    }
    // clear scene, repopulate it with new circles using slider parameters
    s.clear()
    for (let i = 0; i < quantityRange; i++) {
        const c = new Circle(Math.random() * (sizeRange / 2) + sizeRange / 5, "#" + Math.floor(Math.random() * 16777215).toString(16))
        c.position.setXY(Math.random() * canvas.width, Math.random() * canvas.height)
        c.velocity.x = hVelocityRange / 2 - Math.random() * hVelocityRange
        c.velocity.y = vVelocityRange / 2 - Math.random() * vVelocityRange
        s.add(c)
    }
}
// call refresh scene at initial launch so it starts automatically
refreshScene()

// animation loop
function draw(timestamp) {
    s.update()
    // used for average collision time analytics, increases circle quantities or stops increasing if reached max amount
    if (analyticsType === "averageCollisionTime" && performance.now() - startTime > durationOfAnalysis) {
        const stepRate = 100
        if (parseInt(quantityRange) >= 4250) {
            stop = true
            console.log("Analysis complete")
        } else {
            document.getElementById('quantitySlider').stepUp(stepRate)
            quantityRange = document.getElementById('quantitySlider').value
            refreshScene()
        }
        console.log(quantityRange)
    }
    // gets time passed between frames
    dt = timestamp - previousTimestamp
    previousTimestamp = timestamp
    if (!stop) {
        window.requestAnimationFrame(draw)
    }
}
window.requestAnimationFrame(draw)

// used for saving and downloading performance results
const download = document.getElementById('download')
function saveAnalytics() {
    let data = ""
    let header = analyticsType
    if (analyticsType == "energy") {
        header = header.concat("\n")
        const endTime = performance.now()
        for (let i = 0; i < totalEnergies.length; i++) {
            data = data.concat(totalEnergies[i].toString().concat("\n"))
        }
        data = data.concat((endTime - startTime).toString().concat("\n"))
    } else if (analyticsType == "averageCollisionTime") {
        header = header.concat(collisionType.concat("\n"))
        for (let i = 0; i < averageCollisionTimes.length; i++) {
            data = data.concat(averageCollisionTimes[i].toString().concat("\n"))
        }
    } else if (analyticsType === "") { }
    data = header.concat(data)
    download.setAttribute("href", makeTextFile(data))
}

// used for downloading results
let textFile = null
makeTextFile = function (text) {
    const data = new Blob([text], { type: 'text/plain' })
    if (textFile !== null) {
        window.URL.revokeObjectURL(textFile)
    }
    textFile = window.URL.createObjectURL(data)
    return textFile;
}

// used for intersect
function hash(x) {
    return x;
  }
// used for SAP
function intersect(arrays) {
    // make sure first array is the shortest
    if (arrays[1].length < arrays[0].length) {
        let temp = arrays[0];
        arrays[0] = arrays[1];
        arrays[1] = temp;
    }
    const m = new Map();
    for (const el of arrays[0]) {
        m.set(hash(el), 1);
    }
    let found = 0;
    for (const el of arrays[1]) {
        const hashed = hash(el);
        const count = m.get(hashed);
        if (count === 1) {
            m.set(hashed, count + 1);
            found++;
        }
    }
    if (found === 0)
        return [];
    return arrays[0].filter(e => {
        const hashed = hash(e);
        const count = m.get(hashed);
        if (count !== undefined)
            m.set(hashed, 0);
        return count === arrays.length;
    });
}

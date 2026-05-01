const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext("2d");

let camera = { x: 0, y: 0, width: 0, height: 0, dragStart: null, dragging: false, dragged: false };
let selectedUnit = null;
let units = [];
let enemies = [];
let transporters = [];
let map = { width: 40, height: 30, tiles: [] };
let groundTiles = new Set();
let waterTiles = new Set();

let factions = ['red', 'blue', 'green', 'yellow'];
let currentFaction = 'blue';
let factionColors = {
    'red': '#FF4444',
    'blue': '#4444FF',
    'green': '#44FF44',
    'yellow': '#FFFF44'
};
let tileOwnership = [];
let tileCaptureProgress = [];
let captureSpeed = 2;

let zoom = 1;
let minZoom = 0.5;
let maxZoom = 3;
let zoomSpeed = 0.1;

function initOwnership() {
    tileOwnership = [];
    tileCaptureProgress = [];
    
    for (let y = 0; y < map.height; y++) {
        tileOwnership[y] = [];
        tileCaptureProgress[y] = [];
        for (let x = 0; x < map.width; x++) {
            tileOwnership[y][x] = null;
            tileCaptureProgress[y][x] = 0;
        }
    }
    
    // Set initial ownership for starting areas
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
            if (y < map.height && x < map.width) {
                tileOwnership[y][x] = 'green';
            }
        }
    }
    for (let y = map.height-5; y < map.height; y++) {
        for (let x = map.width-5; x < map.width; x++) {
            if (y >= 0 && x >= 0 && y < map.height && x < map.width) {
                tileOwnership[y][x] = 'red';
            }
        }
    }
}

class Unit {
    constructor(x, y, type, faction = null) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.isEnemy = faction != 'green';
        this.faction = faction;
        this.width = 40;
        this.height = 40;
        this.targetX = null;
        this.targetY = null;
        this.targetDir = null;
        this.targetPath = null;
        this.targetIndex = 0;
        this.speed = 2;
        this.health = 100;
        this.attackDamage = 20;
        this.attackCooldown = 0;
        this.attackRange = 60;
        this.direction = 0;
        this.rotationSpeed = 5;
        this.captureRadius = 50;
    }

    canBeOnTile(tileType) {
        if (this.type === 'land') return groundTiles.has(tileType);
        if (this.type === 'water') return waterTiles.has(tileType);
        return true;
    }

    findPathTo(targetX, targetY) {
        let startX = Math.floor(this.x / 40);
        let startY = Math.floor(this.y / 40);
        let targetTileX = Math.floor(targetX / 40);
        let targetTileY = Math.floor(targetY / 40);
        
        if (targetTileX < 0 || targetTileX >= map.width || targetTileY < 0 || targetTileY >= map.height) return null;
        if (!this.canBeOnTile(map.tiles[targetTileY][targetTileX])) return null;
        
        let queue = [{ x: startX, y: startY, path: [] }];
        let visited = new Set();
        visited.add(`${startX},${startY}`);
        
        while (queue.length > 0) {
            let current = queue.shift();
            
            if (current.x === targetTileX && current.y === targetTileY) {
                let waypoints = [];
                for (let step of current.path) {
                    waypoints.push({ x: step.x * 40 + 20, y: step.y * 40 + 20 });
                }
                waypoints.push({ x: targetX, y: targetY });
                return waypoints;
            }
            
            let neighbors = [
                { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, 
                { dx: 0, dy: 1 }, { dx: -1, dy: 0 }
            ];
            
            for (let n of neighbors) {
                let nx = current.x + n.dx;
                let ny = current.y + n.dy;
                
                if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
                    let tileType = map.tiles[ny][nx];
                    if (this.canBeOnTile(tileType) && !visited.has(`${nx},${ny}`)) {
                        visited.add(`${nx},${ny}`);
                        queue.push({
                            x: nx, y: ny,
                            path: [...current.path, { x: nx, y: ny }]
                        });
                    }
                }
            }
        }
        return null;
    }

    moveTo(x, y) {
        let path = this.findPathTo(x, y);
        if (path && path.length > 0) {
            this.targetPath = path;
            this.targetIndex = 0;
            this.targetX = path[0].x;
            this.targetY = path[0].y;
        }
    }

    update() {
        this.captureNearbyTiles();
        if (this.attackCooldown > 0) this.attackCooldown--;
        
        let nearestEnemy = null;
        let minDist = this.attackRange;
        
        let targets = this.isEnemy ? units : [...enemies, ...transporters.filter(t => t.isEnemy && t !== this)];
        for (let other of targets) {
            if (!other || other === this) continue;
            let dx = this.x - other.x;
            let dy = this.y - other.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) {
                minDist = dist;
                nearestEnemy = other;
            }
        }
        
        let canAttack = false;
        if (nearestEnemy && minDist <= this.attackRange) {
            let dxToEnemy = nearestEnemy.x - this.x;
            let dyToEnemy = nearestEnemy.y - this.y;
            let angleToEnemy = Math.atan2(dyToEnemy, dxToEnemy) * 180 / Math.PI;
            let angleDiff = Math.abs(angleToEnemy - this.direction);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            
            if (angleDiff < 45) {
                canAttack = true;
                if (this.attackCooldown === 0) {
                    nearestEnemy.health -= this.attackDamage;
                    this.attackCooldown = 30;
                    if (nearestEnemy.health <= 0) {
                        if (nearestEnemy.isEnemy) {
                            let idx = enemies.indexOf(nearestEnemy);
                            if (idx !== -1) enemies.splice(idx, 1);
                        } else {
                            let idx = units.indexOf(nearestEnemy);
                            if (idx !== -1) units.splice(idx, 1);
                            idx = transporters.indexOf(nearestEnemy);
                            if (idx !== -1) transporters.splice(idx, 1);
                        }
                        if (selectedUnit === nearestEnemy) selectedUnit = null;
                    }
                }
            }
        }

        if(this.targetDir !== null){
            
            if (this.targetDir < 0) this.targetDir += 360;
            
            if (this.direction != this.targetDir) {
                let diff = this.targetDir - this.direction;
                if (diff > 180) diff -= 360;
                if (diff < -180) diff += 360;
                
                if (Math.abs(diff) <= this.rotationSpeed) {
                    this.direction = this.targetDir;
                } else if (diff > 0) {
                    this.direction += this.rotationSpeed;
                } else {
                    this.direction -= this.rotationSpeed;
                }
                
                if (this.direction >= 360) this.direction -= 360;
                if (this.direction < 0) this.direction += 360;
                return;
            }

            
        }
        
        if (this.targetX !== null && this.targetY !== null) {
            let dx = this.targetX - this.x;
            let dy = this.targetY - this.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 0) {
                let targetAngle = Math.atan2(dy, dx) * 180 / Math.PI;
                let targetDir = Math.round(targetAngle / 90) * 90;
                this.targetDir = targetDir;
            }
            
            if (distance < this.speed) {
                this.x = this.targetX;
                this.y = this.targetY;
                
                if (this.targetPath && this.targetIndex + 1 < this.targetPath.length) {
                    this.targetIndex++;
                    this.targetX = this.targetPath[this.targetIndex].x;
                    this.targetY = this.targetPath[this.targetIndex].y;
                } else {
                    this.targetX = null;
                    this.targetY = null;
                    this.targetPath = null;
                }
            } else if (distance > 0) {
                let stepX = (dx / distance) * this.speed;
                let stepY = (dy / distance) * this.speed;
                this.x += stepX;
                this.y += stepY;
            }
        }
    }

    captureNearbyTiles() {
        let centerTileX = Math.floor(this.x / 40);
        let centerTileY = Math.floor(this.y / 40);
        let radiusTiles = Math.ceil(this.captureRadius / 40);
        
        for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
            for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
                let tileX = centerTileX + dx;
                let tileY = centerTileY + dy;
                
                if (tileX >= 0 && tileX < map.width && tileY >= 0 && tileY < map.height) {
                    let tileCenterX = tileX * 40 + 20;
                    let tileCenterY = tileY * 40 + 20;
                    let dxTile = this.x - tileCenterX;
                    let dyTile = this.y - tileCenterY;
                    let distToTile = Math.sqrt(dxTile * dxTile + dyTile * dyTile);
                    
                    if (distToTile <= this.captureRadius) {
                        if (tileOwnership[tileY][tileX] !== this.faction) {
                            tileCaptureProgress[tileY][tileX] += captureSpeed;
                            if (tileCaptureProgress[tileY][tileX] >= 100) {
                                tileOwnership[tileY][tileX] = this.faction;
                                tileCaptureProgress[tileY][tileX] = 0;
                            }
                        } else if (tileCaptureProgress[tileY][tileX] > 0) {
                            tileCaptureProgress[tileY][tileX] = Math.max(0, tileCaptureProgress[tileY][tileX] - captureSpeed);
                        }
                    }
                }
            }
        }
    }

    rotateTo(x, y) {
        let dx = x - this.x;
        let dy = y - this.y;
        let targetAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        let targetDir = Math.round(targetAngle / 90) * 90;
        this.targetDir = targetDir;
    }

    draw() {
        let screenX = (this.x - camera.x) * zoom;
        let screenY = (this.y - camera.y) * zoom;
        let drawWidth = this.width * zoom;
        let drawHeight = this.height * zoom;
        
        if (screenX + this.width/2 < 0 || screenX - this.width/2 > canvas.width || 
            screenY + this.height/2 < 0 || screenY - this.height/2 > canvas.height) return;
        
        context.save();
        context.translate(screenX, screenY);
        context.rotate(this.direction * Math.PI / 180);
        
        if (this.type === 'land') {
            context.fillStyle = factionColors[this.faction] || (this.isEnemy ? '#8B0000' : '#00AA00');
        } else {
            context.fillStyle = factionColors[this.faction] || (this.isEnemy ? '#8B4513' : '#0055AA');
        }
        
        context.fillRect(-this.width/2, -this.height/2, this.width, this.height);
        
        context.fillStyle = '#FF0000';
        context.beginPath();
        context.moveTo(this.width/2, 0);
        context.lineTo(this.width/2 - 10, -8);
        context.lineTo(this.width/2 - 10, 8);
        context.fill();
        
        context.restore();
        
        if (selectedUnit === this) {
            context.strokeStyle = '#FFFF00';
            context.lineWidth = 3;
            context.strokeRect(screenX - this.width/2, screenY - this.height/2, this.width, this.height);
        }
        
        context.fillStyle = '#FFFFFF';
        context.font = '12px Arial';
        context.fillText(`${Math.max(0, this.health)}`, screenX - 10, screenY - 15);
    }
}

class Transporter extends Unit {
    constructor(x, y, faction) {
        super(x, y, 'water', faction);
        this.carriedUnit = null;
        this.width = 50;
        this.height = 50;
    }
    
    loadUnit(unit) {
        if (!this.carriedUnit && unit.type === 'land' && !unit.isEnemy) {
            let dx = Math.abs(this.x - unit.x);
            let dy = Math.abs(this.y - unit.y);
            let distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 60) {
                this.carriedUnit = unit;
                this.carriedUnit.targetX = null;
                this.carriedUnit.targetY = null;
                this.carriedUnit.targetPath = null;
                let idx = units.indexOf(unit);
                if (idx !== -1) units.splice(idx, 1);
                if (selectedUnit === unit) selectedUnit = null;
                return true;
            } else {
                unit.moveTo(this.x, this.y);
            }
        }
        return false;
    }

    unloadUnit(x, y) {
        if (this.carriedUnit) {
            let tileX = Math.floor(x / 40);
            let tileY = Math.floor(y / 40);
            let dx = Math.abs(this.x - x);
            let dy = Math.abs(this.y - y);
            let distanceToUnloadPoint = Math.sqrt(dx * dx + dy * dy);
            
            if (distanceToUnloadPoint < 80 && tileX >= 0 && tileX < map.width && tileY >= 0 && tileY < map.height && groundTiles.has(map.tiles[tileY][tileX])) {
                this.carriedUnit.x = x;
                this.carriedUnit.y = y;
                units.push(this.carriedUnit);
                this.carriedUnit = null;
                return true;
            } else if (distanceToUnloadPoint >= 80) {
                this.moveTo(x, y);
            }
        }
        return false;
    }
    
    draw() {
        let screenX = (this.x - camera.x) * zoom;
        let screenY = (this.y - camera.y) * zoom;
        let drawWidth = this.width * zoom;
        let drawHeight = this.height * zoom;
        
        if (screenX + this.width/2 < 0 || screenX - this.width/2 > canvas.width || 
            screenY + this.height/2 < 0 || screenY - this.height/2 > canvas.height) return;
        
        context.save();
        context.translate(screenX, screenY);
        context.rotate(this.direction * Math.PI / 180);
        
        context.fillStyle = this.isEnemy ? '#CD853F' : '#4169E1';
        context.fillRect(-this.width/2, -this.height/2, this.width, this.height);
        
        context.fillStyle = '#FF0000';
        context.beginPath();
        context.moveTo(this.width/2, 0);
        context.lineTo(this.width/2 - 10, -8);
        context.lineTo(this.width/2 - 10, 8);
        context.fill();
        
        context.restore();
        
        if (this.carriedUnit) {
            context.fillStyle = '#FFD700';
            context.fillRect(screenX - 15, screenY - 15, 30, 30);
        }
        
        if (selectedUnit === this) {
            context.strokeStyle = '#FFFF00';
            context.lineWidth = 3;
            context.strokeRect(screenX - this.width/2, screenY - this.height/2, this.width, this.height);
        }
        
        context.fillStyle = '#FFFFFF';
        context.font = '12px Arial';
        context.fillText(`${Math.max(0, this.health)}`, screenX - 10, screenY - 15);
    }
    
    update() {
        super.update();
    }
}

function handleWheel(e) {
    e.preventDefault();
    let delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
    let newZoom = zoom + delta;
    
    if (newZoom >= minZoom && newZoom <= maxZoom) {
        // Get mouse position relative to canvas
        let rect = canvas.getBoundingClientRect();
        let scaleX = canvas.width / rect.width;
        let scaleY = canvas.height / rect.height;
        let mouseX = (e.clientX - rect.left) * scaleX;
        let mouseY = (e.clientY - rect.top) * scaleY;
        
        // Convert to world coordinates before zoom
        let worldX = mouseX / zoom + camera.x;
        let worldY = mouseY / zoom + camera.y;
        
        // Apply zoom
        zoom = newZoom;
        
        // Adjust camera to keep mouse position fixed
        camera.x = worldX - mouseX / zoom;
        camera.y = worldY - mouseY / zoom;
        
        // Clamp camera
        camera.x = Math.max(0, Math.min(camera.x, map.width * 40 - camera.width / zoom));
        camera.y = Math.max(0, Math.min(camera.y, map.height * 40 - camera.height / zoom));
    }
}

function resizeCanvas() {
    const field = canvas.parentElement;
    if (!field) return;
    
    const maxWidth = window.innerWidth;
    const maxHeight = window.innerHeight;
    
    canvas.width = maxWidth;
    canvas.height = maxHeight;
    canvas.style.width = `${maxWidth}px`;
    canvas.style.height = `${maxHeight}px`;
    
    camera.width = maxWidth;
    camera.height = maxHeight;
}


function generateMap() {
    for (let y = 0; y < map.height; y++) {
        map.tiles[y] = [];
        for (let x = 0; x < map.width; x++) {
            if ((y >= 8 && y <= 12 && x >= 15 && x <= 25) || 
                (y >= 18 && y <= 22 && x >= 5 && x <= 15) ||
                (y >= 5 && y <= 8 && x >= 25 && x <= 35)) {
                map.tiles[y][x] = 'water';
                waterTiles.add('water');
            } else {
                map.tiles[y][x] = 'ground';
                groundTiles.add('ground');
            }
        }
    }
}

function drawMap() {
    let startCol = Math.floor(camera.x / 40);
    let endCol = Math.min(map.width, startCol + Math.ceil(camera.width / (40 * zoom)) + 2);
    let startRow = Math.floor(camera.y / 40);
    let endRow = Math.min(map.height, startRow + Math.ceil(camera.height / (40 * zoom)) + 2);
    
    startCol = Math.max(0, startCol);
    startRow = Math.max(0, startRow);
    let tileSize = 40 * zoom;
    
    for (let y = startRow; y < endRow; y++) {
        for (let x = startCol; x < endCol; x++) {
            let screenX = x * 40 * zoom - camera.x * zoom;
            let screenY = y * 40 * zoom - camera.y * zoom;
            
            // Draw base tile
            if (map.tiles[y][x] === 'ground') {
                context.fillStyle = '#7CFC00';
            } else {
                context.fillStyle = '#1E90FF';
            }
            context.fillRect(screenX, screenY, tileSize, tileSize);
            
            // Draw ownership overlay
            if (tileOwnership[y][x]) {
                context.fillStyle = factionColors[tileOwnership[y][x]];
                context.globalAlpha = 0.5;
                context.fillRect(screenX, screenY, tileSize, tileSize);
                context.globalAlpha = 1;
            }
            
            // Draw capture progress
            if (tileCaptureProgress[y][x] > 0 && tileOwnership[y][x] !== currentFaction) {
                context.fillStyle = '#FFFFFF';
                context.globalAlpha = 0.7;
                let progressHeight = (tileCaptureProgress[y][x] / 100) * tileSize;
                context.fillRect(screenX, screenY + tileSize - progressHeight, tileSize, progressHeight);
                context.globalAlpha = 1;
            }
            
            context.strokeStyle = '#000000';
            context.lineWidth = 1;
            context.strokeRect(screenX, screenY, tileSize, tileSize);
        }
    }
}

function handleCanvasClick(e) {
    
    if(camera.dragging){
        return;
    }
    let rect = canvas.getBoundingClientRect();
    let scaleX = canvas.width / rect.width;
    let scaleY = canvas.height / rect.height;
    let mouseX = (e.clientX - rect.left) * scaleX;
    let mouseY = (e.clientY - rect.top) * scaleY;
    let worldX = mouseX / zoom + camera.x;
    let worldY = mouseY / zoom + camera.y;
    
    let clickedUnit = null;
    let allUnits = [...units, ...enemies, ...transporters];
    
    for (let unit of allUnits) {
        let dx = Math.abs(worldX - unit.x);
        let dy = Math.abs(worldY - unit.y);
        if (dx < unit.width/2 && dy < unit.height/2) {
            clickedUnit = unit;
            break;
        }
    }
    
    if (clickedUnit && !clickedUnit.isEnemy) {
        if(selectedUnit){
            if(clickedUnit == selectedUnit){
                selectedUnit = null;
                return;
            }

            if (clickedUnit instanceof Transporter && !clickedUnit.carriedUnit) {
                // selectedUnit.moveTo(worldX, worldY);
                clickedUnit.loadUnit(selectedUnit);
                selectedUnit = null;
            }

        }

        selectedUnit = clickedUnit;
    } else if (selectedUnit && !clickedUnit) {
        if(camera.dragged){
            camera.dragged = false;
            return;
        }
        if (selectedUnit instanceof Transporter && selectedUnit.carriedUnit) {
            if(selectedUnit.unloadUnit(worldX, worldY)){
                selectedUnit = null;
            }else{
                selectedUnit.moveTo(worldX, worldY);
            }
        } else if (selectedUnit) {
            selectedUnit.moveTo(worldX, worldY);
        }
    }
}

function handleMouseDown(e) {
    camera.dragging = true;
    camera.dragStart = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
}

function handleMouseMove(e) {
    if (camera.dragging && camera.dragStart) {
        camera.dragged = true;
        let dx = e.clientX - camera.dragStart.x;
        let dy = e.clientY - camera.dragStart.y;
        camera.x -= dx / zoom;
        camera.y -= dy / zoom;
        camera.x = Math.max(0, Math.min(camera.x, map.width * 40 - camera.width / zoom));
        camera.y = Math.max(0, Math.min(camera.y, map.height * 40 - camera.height / zoom));
        camera.dragStart = { x: e.clientX, y: e.clientY };
    }
}

function handleMouseUp() {
    camera.dragging = false;
    camera.dragStart = null;
    canvas.style.cursor = 'default';
}

function handleCanvasContextMenu(e) {
    e.preventDefault();
    
    let rect = canvas.getBoundingClientRect();
    let scaleX = canvas.width / rect.width;
    let scaleY = canvas.height / rect.height;
    let mouseX = (e.clientX - rect.left) * scaleX;
    let mouseY = (e.clientY - rect.top) * scaleY;
    let worldX = mouseX + camera.x;
    let worldY = mouseY + camera.y;
    
    if (selectedUnit) {
        selectedUnit.rotateTo(worldX, worldY);
    }
    
    return false;
}

function gameLoop() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    drawMap();
    
    for (let unit of units) unit.update();
    for (let enemy of enemies) enemy.update();
    for (let transporter of transporters) transporter.update();
    
    for (let unit of units) unit.draw();
    for (let enemy of enemies) enemy.draw();
    for (let transporter of transporters) transporter.draw();
    
    requestAnimationFrame(gameLoop);
}

function init() {
    resizeCanvas();
    generateMap();
    initOwnership();
    
    units.push(new Unit(200, 200, 'land', 'green'));
    units.push(new Unit(300, 300, 'land', 'green'));
    units.push(new Unit(400, 250, 'land', 'green'));
    
    enemies.push(new Unit(1000, 500, 'land', 'red'));
    enemies.push(new Unit(1100, 600, 'land', 'red'));
    enemies.push(new Unit(1200, 550, 'water', 'red'));
    enemies.push(new Unit(900, 700, 'water', 'red'));
    
    let t1 = new Transporter(700, 400, 'green');
    let t2 = new Transporter(630, 500, 'green');
    transporters.push(t1);
    transporters.push(t2);
    units.push(t1);
    units.push(t2);
    
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('contextmenu', handleCanvasContextMenu);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel);
    
    gameLoop();
}

window.addEventListener('load', init);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 20));
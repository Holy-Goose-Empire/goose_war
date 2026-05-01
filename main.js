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
const TILE_SIZE = 40;

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

class PriorityQueue {
    constructor(comparator = (a, b) => a < b) {
        this.heap = [];
        this.comparator = comparator;
        this.keys = new Set(); // Для быстрой проверки наличия
    }
    
    push(element) {
        this.heap.push(element);
        this.keys.add(element.key);
        this.bubbleUp(this.heap.length - 1);
    }
    
    pop() {
        if (this.heap.length === 0) return null;
        const min = this.heap[0];
        const last = this.heap.pop();
        this.keys.delete(min.key);
        
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.sinkDown(0);
        }
        return min;
    }
    
    has(key) {
        return this.keys.has(key);
    }
    
    isEmpty() {
        return this.heap.length === 0;
    }
    
    bubbleUp(index) {
        while (index > 0) {
            let parentIndex = Math.floor((index - 1) / 2);
            if (this.comparator(this.heap[parentIndex], this.heap[index])) break;
            [this.heap[parentIndex], this.heap[index]] = [this.heap[index], this.heap[parentIndex]];
            index = parentIndex;
        }
    }
    
    sinkDown(index) {
        let length = this.heap.length;
        while (true) {
            let leftChild = 2 * index + 1;
            let rightChild = 2 * index + 2;
            let swap = null;
            let element = this.heap[index];
            
            if (leftChild < length && this.comparator(this.heap[leftChild], element)) {
                swap = leftChild;
            }
            
            if (rightChild < length) {
                if ((swap === null && this.comparator(this.heap[rightChild], element)) ||
                    (swap !== null && this.comparator(this.heap[rightChild], this.heap[leftChild]))) {
                    swap = rightChild;
                }
            }
            
            if (swap === null) break;
            [this.heap[index], this.heap[swap]] = [this.heap[swap], this.heap[index]];
            index = swap;
        }
    }
}

class Unit {
    constructor(x, y, type, faction = null) {
        this.x = Math.floor(x / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
        this.y = Math.floor(y / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
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

    // Базовые методы, которые могут быть переопределены
    canBeOnTile(tileType) {
        if (this.type === 'land') return groundTiles.has(tileType);
        if (this.type === 'water') return waterTiles.has(tileType);
        return true;
    }

    findPathTo(targetX, targetY) {
        // 1. Кешируем размер тайла (лучше вынести в константы класса)
        const TILE_SIZE = 40;
        const HALF_TILE = TILE_SIZE / 2;
        
        let startX = Math.floor(this.x / TILE_SIZE);
        let startY = Math.floor(this.y / TILE_SIZE);
        let targetTileX = Math.floor(targetX / TILE_SIZE);
        let targetTileY = Math.floor(targetY / TILE_SIZE);
        
        // 2. Ранняя проверка валидности
        if (!this.isValidTile(targetTileX, targetTileY) || 
            !this.canBeOnTile(map.tiles[targetTileY][targetTileX])) {
            return null;
        }
        
        // 3. Если старт и цель совпадают
        if (startX === targetTileX && startY === targetTileY) {
            return [{ x: targetX, y: targetY }];
        }
        
        // 4. Используем PriorityQueue для A* вместо BFS (оптимальнее)
        let openSet = new PriorityQueue((a, b) => a.f < b.f);
        let cameFrom = new Map();
        let gScore = new Map();
        let fScore = new Map();
        
        let startKey = this.getTileKey(startX, startY);
        gScore.set(startKey, 0);
        fScore.set(startKey, this.heuristic(startX, startY, targetTileX, targetTileY));
        openSet.push({
            x: startX, y: startY,
            f: fScore.get(startKey),
            key: startKey
        });
        
        while (!openSet.isEmpty()) {
            let current = openSet.pop();
            
            if (current.x === targetTileX && current.y === targetTileY) {
                return this.reconstructPath(cameFrom, current, targetX, targetY, TILE_SIZE, HALF_TILE);
            }
            
            let neighbors = this.getNeighbors(current.x, current.y);
            for (let neighbor of neighbors) {
                if (!this.canBeOnTile(map.tiles[neighbor.y][neighbor.x])) continue;
                
                let neighborKey = this.getTileKey(neighbor.x, neighbor.y);
                let tentativeG = gScore.get(current.key) + 1;
                
                if (!gScore.has(neighborKey) || tentativeG < gScore.get(neighborKey)) {
                    cameFrom.set(neighborKey, current);
                    gScore.set(neighborKey, tentativeG);
                    let h = this.heuristic(neighbor.x, neighbor.y, targetTileX, targetTileY);
                    fScore.set(neighborKey, tentativeG + h);
                    
                    // Оптимизация: добавляем только если нет в openSet с меньшим f
                    if (!openSet.has(neighborKey)) {
                        openSet.push({
                            x: neighbor.x, y: neighbor.y,
                            f: fScore.get(neighborKey),
                            key: neighborKey
                        });
                    }
                }
            }
        }
        return null;
    }

    // Вспомогательные методы
    heuristic(x1, y1, x2, y2) {
        // Манхэттенская дистанция (подходит для 4-направлений)
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }

    getNeighbors(x, y) {
        return [
            { dx: 0, dy: -1, x: x, y: y - 1 }, // вверх
            { dx: 1, dy: 0, x: x + 1, y: y },   // вправо
            { dx: 0, dy: 1, x: x, y: y + 1 },   // вниз
            { dx: -1, dy: 0, x: x - 1, y: y }   // влево
        ].filter(n => this.isValidTile(n.x, n.y));
    }

    isValidTile(x, y) {
        return x >= 0 && x < map.width && y >= 0 && y < map.height;
    }

    getTileKey(x, y) {
        return `${x},${y}`;
    }

    reconstructPath(cameFrom, current, targetX, targetY, tileSize, halfTile) {
        let path = [];
        let currentKey = this.getTileKey(current.x, current.y);
        
        while (cameFrom.has(currentKey)) {
            let prev = cameFrom.get(currentKey);
            path.unshift({
                x: prev.x * tileSize + halfTile,
                y: prev.y * tileSize + halfTile
            });
            currentKey = this.getTileKey(prev.x, prev.y);
        }
        
        // Добавляем конечную точку
        path.push({ x: targetX, y: targetY });
        return path;
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

    // Общий метод update, который вызывает специфичные методы
    update() {
        this.captureNearbyTiles();
        if (this.attackCooldown > 0) this.attackCooldown--;
        
        this.updateCombat();  // Выносим боевую логику
        this.updateMovement(); // Выносим логику движения
    }

    updateCombat() {
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
        
        if (nearestEnemy && minDist <= this.attackRange) {
            let dxToEnemy = nearestEnemy.x - this.x;
            let dyToEnemy = nearestEnemy.y - this.y;
            let angleToEnemy = Math.atan2(dyToEnemy, dxToEnemy) * 180 / Math.PI;
            let angleDiff = Math.abs(angleToEnemy - this.direction);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            
            if (angleDiff < 45 && this.attackCooldown === 0) {
                nearestEnemy.health -= this.attackDamage;
                this.attackCooldown = 30;
                if (nearestEnemy.health <= 0) {
                    this.removeDeadUnit(nearestEnemy);
                }
            }
        }
    }

    removeDeadUnit(unit) {
        if (unit.isEnemy) {
            let idx = enemies.indexOf(unit);
            if (idx !== -1) enemies.splice(idx, 1);
        } else {
            let idx = units.indexOf(unit);
            if (idx !== -1) units.splice(idx, 1);
            idx = transporters.indexOf(unit);
            if (idx !== -1) transporters.splice(idx, 1);
        }
        if (selectedUnit === unit) selectedUnit = null;
    }

    updateMovement() {
        if(this.targetDir !== null){
            if (this.targetDir < 0) this.targetDir += 360;
            
            if (this.direction != this.targetDir) {
                let diff = this.targetDir - this.direction;
                if (diff > 180) diff -= 360;
                if (diff < -180) diff += 360;
                
                if (Math.abs(diff) <= this.rotationSpeed) {
                    this.direction = this.targetDir;
                    this.targetDir = null; // Сбрасываем targetDir после достижения
                } else if (diff > 0) {
                    this.direction += this.rotationSpeed;
                } else {
                    this.direction -= this.rotationSpeed;
                }
                
                if (this.direction >= 360) this.direction -= 360;
                if (this.direction < 0) this.direction += 360;
                return;
            } else {
                this.targetDir = null;
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
                    this.targetIndex = 0;
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
        
        if (screenX + drawWidth/2 < 0 || screenX - drawWidth/2 > canvas.width - 0 || 
            screenY + drawHeight/2 < 0 || screenY - drawHeight/2 > canvas.height) return;
        
        this.drawPath();

        context.save();
        context.translate(screenX, screenY);
        context.rotate(this.direction * Math.PI / 180);
        context.scale(zoom, zoom);
        
        this.drawBody(); // Выносим отрисовку тела в отдельный метод
        
        const arrowSize = 12;
        context.fillStyle = '#FF0000';
        context.beginPath();
        context.moveTo(this.width/2, 0);
        context.lineTo(this.width/2 - arrowSize, -arrowSize/2);
        context.lineTo(this.width/2 - arrowSize, arrowSize/2);
        context.fill();
        
        context.restore();
        
        this.drawSelection(); // Выносим отрисовку выделения
        this.drawHealth();    // Выносим отрисовку здоровья
    }

    drawBody() {
        context.fillStyle = factionColors[this.faction] || (this.isEnemy ? '#8B0000' : '#00AA00');
        context.fillRect(-this.width/2, -this.height/2, this.width, this.height);
    }

    drawSelection() {
        if (selectedUnit === this) {
            context.strokeStyle = '#FFFF00';
            context.lineWidth = 3;
            context.strokeRect((this.x - camera.x) * zoom - (this.width * zoom)/2, 
                              (this.y - camera.y) * zoom - (this.height * zoom)/2, 
                              this.width * zoom, this.height * zoom);
        }
    }

    drawHealth() {
        context.fillStyle = '#FFFFFF';
        let fontsize = 12 * zoom;
        context.font = `${fontsize}px Arial`;
        context.textAlign = 'center';
        context.fillText(`${Math.max(0, this.health)}`, 
                        (this.x - camera.x) * zoom, 
                        (this.y - camera.y) * zoom - (this.height * zoom)/2 + 10*zoom);
    }

    drawPath() {
        // Проверяем, есть ли путь для отрисовки
        if (!this.targetPath || this.targetPath.length === 0) return;
        
        // Проверяем, выбран ли юнит (опционально - можно всегда рисовать)
        if (selectedUnit !== this) return;
        
        context.save();
        
        // Настройки линии пути
        context.beginPath();
        context.strokeStyle = '#FFD700'; // Золотистый цвет
        context.lineWidth = 3 * zoom;
        context.setLineDash([5, 5]); // Пунктирная линия
        context.shadowBlur = 0; // Отключаем тень для производительности
        
        // Рисуем линии между точками пути
        for (let i = 0; i < this.targetPath.length - 1; i++) {
            let point1 = this.targetPath[i];
            let point2 = this.targetPath[i + 1];
            
            let screenX1 = (point1.x - camera.x) * zoom;
            let screenY1 = (point1.y - camera.y) * zoom;
            let screenX2 = (point2.x - camera.x) * zoom;
            let screenY2 = (point2.y - camera.y) * zoom;
            
            // Проверка видимости (базовое отсечение)
            if (this.isPointVisible(screenX1, screenY1) || 
                this.isPointVisible(screenX2, screenY2)) {
                
                context.beginPath();
                context.moveTo(screenX1, screenY1);
                context.lineTo(screenX2, screenY2);
                context.stroke();
            }
        }
        
        // Рисуем маркеры точек пути
        context.setLineDash([]); // Сплошная линия для маркеров
        
        for (let i = 0; i < this.targetPath.length; i++) {
            let point = this.targetPath[i];
            let screenX = (point.x - camera.x) * zoom;
            let screenY = (point.y - camera.y) * zoom;
            
            if (this.isPointVisible(screenX, screenY)) {
                // Разный стиль для первой, промежуточных и последней точки
                if (i === 0) {
                    // Стартовая точка (зеленый круг)
                    context.fillStyle = '#00FF00';
                    context.beginPath();
                    context.arc(screenX, screenY, 5 * zoom, 0, Math.PI * 2);
                    context.fill();
                    // context.fillStyle = '#FFFFFF';
                    // context.font = `${10 * zoom}px Arial`;
                    // context.textAlign = 'center';
                    // context.fillText("Старт", screenX, screenY - 8 * zoom);
                } 
                else if (i === this.targetPath.length - 1) {
                    // Конечная точка (красный круг)
                    context.fillStyle = '#FF0000';
                    context.beginPath();
                    context.arc(screenX, screenY, 5 * zoom, 0, Math.PI * 2);
                    context.fill();
                    // context.fillStyle = '#FFFFFF';
                    // context.font = `${10 * zoom}px Arial`;
                    // context.textAlign = 'center';
                    // context.fillText("Цель", screenX, screenY - 8 * zoom);
                }
                else {
                    // Промежуточные точки (маленькие синие круги)
                    context.fillStyle = '#0099FF';
                    context.beginPath();
                    context.arc(screenX, screenY, 3 * zoom, 0, Math.PI * 2);
                    context.fill();
                }
            }
        }
        
        // Рисуем стрелку направления к следующей точке
        if (this.targetPath.length > 0 && this.targetIndex < this.targetPath.length) {
            let currentTarget = this.targetPath[this.targetIndex];
            let currentPos = { x: this.x, y: this.y };
            
            let screenCurrentX = (currentPos.x - camera.x) * zoom;
            let screenCurrentY = (currentPos.y - camera.y) * zoom;
            let screenTargetX = (currentTarget.x - camera.x) * zoom;
            let screenTargetY = (currentTarget.y - camera.y) * zoom;
            
            if (this.isPointVisible(screenCurrentX, screenCurrentY) &&
                this.isPointVisible(screenTargetX, screenTargetY)) {
                
                // Рисуем стрелку направления
                let angle = Math.atan2(screenTargetY - screenCurrentY, 
                                    screenTargetX - screenCurrentX);
                let arrowSize = 15 * zoom;
                let arrowX = screenCurrentX + Math.cos(angle) * 20 * zoom;
                let arrowY = screenCurrentY + Math.sin(angle) * 20 * zoom;
                
                context.fillStyle = '#FFD700';
                context.beginPath();
                context.moveTo(arrowX, arrowY);
                context.lineTo(arrowX - arrowSize * 0.5, arrowY - arrowSize * 0.5);
                context.lineTo(arrowX - arrowSize * 0.3, arrowY);
                context.lineTo(arrowX - arrowSize * 0.5, arrowY + arrowSize * 0.5);
                context.fill();
            }
        }
        
        // Рисуем информацию о пути
        // if (selectedUnit === this && this.targetPath.length > 0) {
        //     let totalDistance = this.calculatePathDistance();
        //     let fontSize = 12 * zoom;
        //     context.font = `${fontSize}px Arial`;
        //     context.fillStyle = '#FFFFFF';
        //     context.shadowBlur = 2;
        //     context.shadowColor = 'black';
            
        //     let infoX = (this.x - camera.x) * zoom;
        //     let infoY = (this.y - camera.y) * zoom - (this.height * zoom) - 10 * zoom;
            
        //     context.fillText(`Путь: ${this.targetPath.length} точек`, 
        //                     infoX, infoY);
        //     context.fillText(`Дистанция: ${Math.round(totalDistance)}`, 
        //                     infoX, infoY + fontSize + 2);
        // }
        
        context.restore();
    }

    // Вспомогательные методы
    isPointVisible(screenX, screenY) {
        // Проверяет, находится ли точка в пределах экрана с небольшим запасом
        let margin = 100;
        return screenX + margin >= 0 && 
            screenX - margin <= canvas.width && 
            screenY + margin >= 0 && 
            screenY - margin <= canvas.height;
    }

    calculatePathDistance() {
        // Вычисляет общую длину пути
        if (!this.targetPath || this.targetPath.length < 2) return 0;
        
        let totalDistance = 0;
        let prevPoint = this.targetPath[0];
        
        for (let i = 1; i < this.targetPath.length; i++) {
            let currentPoint = this.targetPath[i];
            let dx = currentPoint.x - prevPoint.x;
            let dy = currentPoint.y - prevPoint.y;
            totalDistance += Math.sqrt(dx * dx + dy * dy);
            prevPoint = currentPoint;
        }
        
        return totalDistance;
    }
    
}

class Transporter extends Unit {
    constructor(x, y, faction) {
        super(x, y, 'water', faction);
        this.carriedUnit = null;
        this.width = 40;
        this.height = 40;
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
    
    drawBody() {
        context.fillStyle = this.isEnemy ? '#CD853F' : '#4169E1';
        context.fillRect(-this.width/2, -this.height/2, this.width, this.height);
    }
    
    draw() {
        super.draw(); // Вызываем родительский метод
        
        // Добавляем специфичную для транспортера отрисовку
        if (this.carriedUnit) {
            context.fillStyle = '#FFD700';
            context.fillRect((this.x - camera.x) * zoom - 15, 
                            (this.y - camera.y) * zoom - 15, 
                            30, 30);
        }
    }
    
    // Transporter может переопределить update для добавления своей логики
    update() {
        super.update(); // Вызываем родительский update
        // Добавляем специфичную для транспортера логику здесь
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

    let tileX = Math.floor(worldX / TILE_SIZE);
    let tileY = Math.floor(worldY / TILE_SIZE);
    worldX = tileX * TILE_SIZE + TILE_SIZE / 2;
    worldY = tileY * TILE_SIZE + TILE_SIZE / 2;
    
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
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (canvas && context) {
            resizeCanvas();
        }
    }, 100);
});
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 20));
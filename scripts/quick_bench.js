#!/usr/bin/env node
/** Precise benchmark + evaluation tuning */

const SLIDE_TABLES=(function(){
  const tables=[null,null,null,null];
  for(let d=0;d<4;d++){
    const table=new Map();
    for(let key=0;key<65536;key++){
      const values=[key&0xF,(key>>4)&0xF,(key>>8)&0xF,(key>>12)&0xF];
      const ordered=d===1||d===3?[values[3],values[2],values[1],values[0]]:values.slice();
      const tiles=ordered.filter(v=>v>0);
      const result=[];let gained=0;
      for(let i=0;i<tiles.length;i++){
        if(i+1<tiles.length&&tiles[i]===tiles[i+1]){gained+=tiles[i]*2;result.push(tiles[i]*2);i++}else{result.push(tiles[i])}
      }
      while(result.length<4)result.push(0);
      const finalOrder=d===1||d===3?[result[3],result[2],result[1],result[0]]:result;
      const encoded=finalOrder[0]|(finalOrder[1]<<4)|(finalOrder[2]<<8)|(finalOrder[3]<<12);
      const changed=values.join(',')!==finalOrder.join(',');
      table.set(key,{encoded,gained,changed});
    }
    tables[d]=table;
  }
  return tables;
})();

function tileEncode(v){return v>0?Math.min(Math.log2(v)|0,15):0;}
function tileDecode(e){return e>0?(1<<e):0;}
function moveFast(grid,direction){
  const table=SLIDE_TABLES[direction];
  const next=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  let changed=false,gained=0;
  for(let idx=0;idx<4;idx++){
    let key;
    if(direction===0){key=tileEncode(grid[0][idx])|(tileEncode(grid[1][idx])<<4)|(tileEncode(grid[2][idx])<<8)|(tileEncode(grid[3][idx])<<12);}
    else if(direction===2){key=tileEncode(grid[3][idx])|(tileEncode(grid[2][idx])<<4)|(tileEncode(grid[1][idx])<<8)|(tileEncode(grid[0][idx])<<12);}
    else if(direction===3){key=tileEncode(grid[idx][0])|(tileEncode(grid[idx][1])<<4)|(tileEncode(grid[idx][2])<<8)|(tileEncode(grid[idx][3])<<12);}
    else{key=tileEncode(grid[idx][3])|(tileEncode(grid[idx][2])<<4)|(tileEncode(grid[idx][1])<<8)|(tileEncode(grid[idx][0])<<12);}
    const result=table.get(key);
    if(result.changed)changed=true;
    gained+=result.gained;
    const vals=[result.encoded&0xF,(result.encoded>>4)&0xF,(result.encoded>>8)&0xF,(result.encoded>>12)&0xF];
    if(direction===0){for(let r=0;r<4;r++)next[r][idx]=tileDecode(vals[r]);}
    else if(direction===2){for(let r=0;r<4;r++)next[3-r][idx]=tileDecode(vals[r]);}
    else if(direction===3){for(let c=0;c<4;c++)next[idx][c]=tileDecode(vals[c]);}
    else{for(let c=0;c<4;c++)next[idx][3-c]=tileDecode(vals[c]);}
  }
  return {board:next,changed,gained};
}

function emptyCells(grid){const cells=[];for(let r=0;r<4;r++)for(let c=0;c<4;c++)if(!grid[r][c])cells.push([r,c]);return cells}
function hasMoves(b){for(let r=0;r<4;r++)for(let c=0;c<4;c++){if(!b[r][c])return true;if(c<3&&b[r][c]===b[r][c+1])return true;if(r<3&&b[r][c]===b[r+1][c])return true}return false}
function addTile(b,rng){const cells=emptyCells(b);if(!cells.length)return;const[r,c]=cells[Math.floor(rng()*cells.length)];b[r][c]=rng()<0.9?2:4}
function rng(seed){let s=seed|0;return function(){s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
function initBoard(r){const b=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];addTile(b,r);addTile(b,r);return b}
function clone(b){return [b[0].slice(),b[1].slice(),b[2].slice(),b[3].slice()]}

// Variable evaluation function based on weights
function makeEval(weights){
  return function(grid){
    const empty=emptyCells(grid).length;
    let max=0;
    for(let r=0;r<4;r++)for(let c=0;c<4;c++)max=Math.max(max,grid[r][c]);

    // Structure (snake pattern)
    const snake=[[15,14,13,12],[8,9,10,11],[7,6,5,4],[0,1,2,3]];
    let structure=0;
    for(let r=0;r<4;r++)for(let c=0;c<4;c++)structure+=grid[r][c]*snake[r][c];

    // Smoothness (using log scale - more natural)
    let smoothness=0;
    for(let r=0;r<4;r++)for(let c=0;c<4;c++){
      const v=grid[r][c];
      if(v===0)continue;
      const lv=Math.log2(v);
      if(c<3&&grid[r][c+1])smoothness-=Math.abs(lv-Math.log2(grid[r][c+1]));
      if(r<3&&grid[r+1][c])smoothness-=Math.abs(lv-Math.log2(grid[r+1][c]));
    }

    // Merges
    let merges=0;
    for(let r=0;r<4;r++)for(let c=0;c<4;c++){
      const v=grid[r][c];
      if(c<3&&v===grid[r][c+1]&&v>0)merges++;
      if(r<3&&v===grid[r+1][c]&&v>0)merges++;
    }

    // Corner bonus
    let corner=0;
    if(max>0){
      for(const[r,c]of[[0,0],[0,3],[3,0],[3,3]])if(grid[r][c]===max){corner=max*weights.corner;break;}
    }

    // Empty bonus
    const emptyBonus=empty===0?0:Math.pow(empty,1.5)*weights.empty;

    // Max tile bonus
    const maxBonus=Math.log2(max||1)*weights.maxTile;

    return structure*weights.structure+emptyBonus+corner+smoothness*weights.smoothness+merges*weights.merges+maxBonus;
  };
}

// Alpha-Beta Expectimax
function exAB(grid,depth,isChance,alpha,beta,table,w){
  if(depth<=0)return w(grid);
  let value;
  if(!isChance){
    value=-Infinity;
    const moves=[];
    for(let d=0;d<4;d++){const r=moveFast(grid,d);if(r.changed)moves.push(r);}
    if(moves.length===0)return -100000;
    moves.sort((a,b)=>b.gained-a.gained);
    for(const m of moves){
      const cv=m.gained+exAB(m.board,depth-1,true,alpha,beta,table,w);
      if(cv>value)value=cv;
      if(value>alpha)alpha=value;
      if(alpha>=beta)return value;
    }
  }else{
    const cells=emptyCells(grid);
    if(!cells.length)return exAB(grid,depth-1,false,alpha,beta,table,w);
    let total=0;
    const n=cells.length<=4?cells.length:4;
    const step=Math.floor(cells.length/n);
    for(let i=0;i<n;i++){
      const[r,c]=cells[i*step];
      const t2=clone(grid);t2[r][c]=2;
      const t4=clone(grid);t4[r][c]=4;
      total+=0.9*exAB(t2,depth-1,false,alpha,beta,table,w);
      total+=0.1*exAB(t4,depth-1,false,alpha,beta,table,w);
    }
    value=total/n;
  }
  return value;
}

function bestMove(grid,depth,table,w){
  let bestDir=null,bestScore=-Infinity;
  const moves=[];
  for(let d=0;d<4;d++){const r=moveFast(grid,d);if(r.changed)moves.push({d,r});}
  if(moves.length===0)return null;
  moves.sort((a,b)=>b.r.gained-a.r.gained);
  for(const m of moves){
    const v=m.r.gained+exAB(m.r.board,depth,true,-Infinity,Infinity,table,w);
    if(v>bestScore){bestScore=v;bestDir=m.d;}
  }
  return bestDir;
}

function playGame(seed,depth,w){
  const r=rng(seed);
  const b=initBoard(r);
  let m=0;
  while(hasMoves(b)&&m<3000){
    const table=new Map(); // Fresh table each move
    const d=bestMove(b,depth,table,w);
    if(d===null)break;
    const{board:nb}=moveFast(b,d);
    b[0]=nb[0];b[1]=nb[1];b[2]=nb[2];b[3]=nb[3];
    addTile(b,r);
    m++;
  }
  const mx=Math.max(...b.flat());
  return{win:mx>=2048,moves:m,maxTile:mx};
}

// Test different weight configurations
const weightSets=[
  {name:'current',structure:2/3,empty:50,corner:10,smoothness:8,merges:60,maxTile:30},
  {name:'corner-heavy',structure:1,empty:30,corner:50,smoothness:5,merges:40,maxTile:50},
  {name:'empty-focus',structure:0.5,empty:100,corner:20,smoothness:10,merges:30,maxTile:40},
  {name:'merge-focus',structure:1,empty:40,corner:30,smoothness:5,merges:100,maxTile:40},
  {name:'balanced',structure:0.8,empty:60,corner:40,smoothness:6,merges:70,maxTile:45},
  {name:'mono-corner',structure:1.5,empty:80,corner:100,smoothness:3,merges:50,maxTile:60},
];

const N=parseInt(process.argv[2])||20;
const depth=parseInt(process.argv[3])||4;

console.log('=== Eval Function Tuning (depth='+depth+', N='+N+') ===\n');
for(const ws of weightSets){
  const w=makeEval(ws);
  const s=Date.now();
  const res=[];
  for(let i=0;i<N;i++)res.push(playGame(500000+i,depth,w));
  const wins=res.filter(r=>r.win).length;
  const t=Date.now()-s;
  const avgMoves=res.reduce((a,b)=>a+b.moves,0)/N;
  const tileDist={};
  res.forEach(r=>{const k=r.maxTile;tileDist[k]=(tileDist[k]||0)+1;});
  const top3=Object.entries(tileDist).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>k+'('+v+')').join(',');
  console.log(ws.name.padEnd(15)+': '+(wins/N*100).toFixed(0)+'% win | '+avgMoves.toFixed(0)+' moves | '+t+'ms | Top: '+top3);
}

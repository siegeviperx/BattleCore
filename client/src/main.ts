import './style.css';
import { createEngine } from './ai';
import { Controller } from './app/controller';
import { createBoardView } from './render';
import { createHud } from './ui';

const boardEl = document.getElementById('board')!;
const hudEl = document.getElementById('hud')!;

const controller = new Controller(createBoardView(boardEl), createHud(hudEl), createEngine());
void controller.start();

// Dev-only handle for automated browser tests and console poking.
if (import.meta.env.DEV) (window as unknown as { __battlecore: Controller }).__battlecore = controller;

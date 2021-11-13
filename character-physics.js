/* this is the character physics implementation.
it sets up and ticks the physics loop for our local character */

import * as THREE from 'three';
import cameraManager from './camera-manager.js';
import {getPlayerCrouchFactor} from './character-controller.js';
import physicsManager from './physics-manager.js';
import ioManager from './io-manager.js';
import {getVelocityDampingFactor} from './util.js';
import {groundFriction, flyFriction, airFriction} from './constants.js';
import {applyVelocity} from './util.js';
import {getRenderer, camera} from './renderer.js';
import physx from './physx.js';
import metaversefileApi from 'metaversefile';

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3 = new THREE.Vector3();
const localVector4 = new THREE.Vector3();
const localVector5 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localQuaternion2 = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();

const zeroVector = new THREE.Vector3();
const upVector = new THREE.Vector3(0, 1, 0);

class CharacterPhysics {
  constructor(player) {
    this.player = player;

    this.velocity = new THREE.Vector3();
    this.sitOffset = new THREE.Vector3();
  }
  /* apply the currently held keys to the character */
  applyWasd(keysDirection, timeDiff) {
    this.velocity.add(keysDirection);
  }
  applyGravity(timeDiffS) {
    if (this.player.avatar) {
      if (!this.player.hasAction('fly')) {
        localVector.copy(physicsManager.getGravity())
          .multiplyScalar(timeDiffS);
        this.velocity.add(localVector);
      }
    }
  }
  getAvatarCapsule(v) {
    const avatarHeight = physicsManager.getAvatarHeight();
    v.set(0, -avatarHeight * 0.5, 0); // XXX use the proper crouch height
    v.radius = 0.3 / 1.6 * avatarHeight;
    v.halfHeight = Math.max(avatarHeight * 0.5 - v.radius, 0);
    return v;
  }
  collideCapsule = (() => {
    const localVector = new THREE.Vector3();
    return (p, q) => {
      this.getAvatarCapsule(localVector);
      localVector.add(p);
      return physx.physxWorker.collidePhysics(physx.physics, localVector.radius, localVector.halfHeight, localVector, q, 4);
    };
  })()
  applyAvatarPhysicsDetail(
    velocityAvatarDirection,
    updateRig,
    timeDiffS,
  ) {
    if (physicsManager.physicsEnabled) {
      // capsule physics
      if (!this.player.hasAction('sit')) {
        applyVelocity(this.player.position, this.velocity, timeDiffS);

        this.player.updateMatrixWorld();
        this.player.matrixWorld.decompose(localVector, localQuaternion, localVector2);

        const collision = this.collideCapsule(localVector, localQuaternion2.set(0, 0, 0, 1));

        // avatar facing direction
        if (velocityAvatarDirection) {
          const horizontalVelocity = localVector5.set(
            this.velocity.x,
            0,
            this.velocity.z
          );
          if (horizontalVelocity.lengthSq() > 0.001) {
            localQuaternion.setFromRotationMatrix(
              localMatrix.lookAt(
                zeroVector,
                horizontalVelocity,
                upVector
              )
            );
          }
        } else {
          localQuaternion.copy(camera.quaternion);
        }

        const jumpAction = this.player.getAction('jump');
        const _ensureJumpAction = () => {
          if (!jumpAction) {
            const newJumpAction = {
              type: 'jump',
              time: 0,
            };
            this.player.addAction(newJumpAction);
          } else {
            jumpAction.set('time', 0);
          }
        };
        const _ensureNoJumpAction = () => {
          this.player.removeAction('jump');
        };
        if (collision) {
          const crouchOffset = physicsManager.getAvatarHeight() * (1 - getPlayerCrouchFactor(this.player)) * 0.5;
          localVector4
            .fromArray(collision.direction)
            .add(localVector5.set(0, -crouchOffset, 0));
          camera.position.add(localVector4)
          localVector.add(localVector4);

          if (collision.grounded) {
            this.velocity.y = 0;
            _ensureNoJumpAction();
          } else if (!jumpAction) {
            _ensureJumpAction();
          }
        } else if (!jumpAction && this.velocity.y < -4) {
          _ensureJumpAction();
        }
      } else {
        this.velocity.y = 0;

        const sitAction = this.player.getAction('sit');

        const objInstanceId = sitAction.controllingId;
        const controlledApp = metaversefileApi.getAppByInstanceId(objInstanceId);
        const sitPos = sitAction.controllingBone ? sitAction.controllingBone : controlledApp;

        const sitComponent = controlledApp.getComponent('sit');
        const {
          sitOffset = [0, 0, 0],
          // damping,
        } = sitComponent;
        this.sitOffset.fromArray(sitOffset);

        applyVelocity(controlledApp.position, this.velocity, timeDiffS);
        if (this.velocity.lengthSq() > 0) {
          controlledApp.quaternion
            .setFromUnitVectors(
              localVector4.set(0, 0, -1),
              localVector5.set(this.velocity.x, 0, this.velocity.z).normalize()
            )
            .premultiply(localQuaternion2.setFromAxisAngle(localVector3.set(0, 1, 0), Math.PI));
        }
        controlledApp.updateMatrixWorld();

        localMatrix.copy(sitPos.matrixWorld)
          .decompose(localVector, localQuaternion, localVector2);

        localVector.add(this.sitOffset);
        localVector.y += 1;
        localQuaternion.premultiply(localQuaternion2.setFromAxisAngle(localVector3.set(0, 1, 0), Math.PI));
      }
      localMatrix.compose(localVector, localQuaternion, localVector2);

      // apply to player
      if (updateRig) {
        this.player.matrix.copy(localMatrix);
      } else {
        this.player.matrix.identity();
      }
      this.player.matrix
        .decompose(this.player.position, this.player.quaternion, this.player.scale);
      this.player.matrixWorld.copy(this.player.matrix);

      if (this.avatar) {
        if (this.player.hasAction('jump')) {
          this.avatar.setFloorHeight(-0xFFFFFF);
        } else {
          this.avatar.setFloorHeight(localVector.y - physicsManager.getAvatarHeight());
        }
      }
    }
  }
  /* dampen the velocity to make physical sense for the current avatar state */
  applyDamping(timeDiffS) {
    const timeDiff = timeDiffS * 1000;
    if (this.player.hasAction('fly')) {
      const factor = getVelocityDampingFactor(flyFriction, timeDiff);
      this.velocity.multiplyScalar(factor);
    } else {
      const factor = getVelocityDampingFactor(groundFriction, timeDiff);
      this.velocity.x *= factor;
      this.velocity.z *= factor;
    }
  }
  applyAvatarPhysics(timeDiffS) {
    const renderer = getRenderer();
    const session = renderer.xr.getSession();

    if (session) {
      if (ioManager.currentWalked || this.player.hasAction('jump')) {
        // const originalPosition = avatarWorldObject.position.clone();

        this.applyAvatarPhysicsDetail(false, false, timeDiffS);

        /* dolly.position.add(
          avatarWorldObject.position.clone().sub(originalPosition)
        ); */
      } else {
        this.velocity.y = 0;
      }
    } else {
      const cameraMode = cameraManager.getMode();
      switch (cameraMode) {
        case 'firstperson': {
          this.applyAvatarPhysicsDetail(false, true, timeDiffS);
          break;
        }
        case 'isometric': {
          if (this.player.hasAction('aim') && !this.player.hasAction('narutoRun')) {
            this.applyAvatarPhysicsDetail(false, true, timeDiffS);
          } else {
            this.applyAvatarPhysicsDetail(true, true, timeDiffS);
          }
          break;
        }
        case 'birdseye': {
          this.applyAvatarPhysicsDetail(true, true, timeDiffS);
          break;
        }
        default: {
          throw new Error('invalid camera mode: ' + cameraMode);
        }
      }
    }

    // offset the camera back from the avatar
    const avatarCameraOffset = session ? zeroVector : cameraManager.getCameraOffset();
    camera.position.copy(this.player.position)
      .sub(
        localVector.copy(avatarCameraOffset)
          .applyQuaternion(camera.quaternion)
      );
    camera.updateMatrixWorld();
  }
  update(timeDiffS) {
    this.applyGravity(timeDiffS);
    this.applyDamping(timeDiffS);
    this.applyAvatarPhysics(timeDiffS);
  }
  reset() {
    this.velocity.set(0, 0, 0);
  }
}

export {
  CharacterPhysics,
};
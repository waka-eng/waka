import {validateStageOptions} from './stage-env-policy.mjs';
try{validateStageOptions(process.env);console.log('Explicit stage options validated; unset policy/destination choices remain unverified.');}
catch{console.error('Invalid stage option; review configured option names without printing values.');process.exitCode=1;}

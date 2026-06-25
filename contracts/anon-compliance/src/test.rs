#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Bytes};

fn hash(env: &Env, parts: &[BytesN<32>]) -> BytesN<32> {
    let mut bytes = Bytes::new(env);
    for part in parts {
        bytes.append(&part.clone().into());
    }
    env.crypto().sha256(&bytes).into()
}

fn bytes32(env: &Env, value: u8) -> BytesN<32> {
    BytesN::from_array(env, &[value; 32])
}

#[test]
fn accepts_valid_demo_proof_and_blocks_replay() {
    let env = Env::default();
    let contract_id = env.register(AnonComplianceContract, ());
    let client = AnonComplianceContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let policy_hash = bytes32(&env, 1);
    let verifier_hash = bytes32(&env, 2);

    env.mock_all_auths();
    client.initialize(&admin, &policy_hash, &verifier_hash);

    let subject_commitment = bytes32(&env, 3);
    let public_input_hash = bytes32(&env, 4);
    let nullifier = bytes32(&env, 5);
    let proof_hash = hash(
        &env,
        &[
            subject_commitment.clone(),
            public_input_hash.clone(),
            nullifier.clone(),
            policy_hash.clone(),
            verifier_hash.clone(),
        ],
    );

    let attestation = client.submit_compliance(
        &subject_commitment,
        &public_input_hash,
        &nullifier,
        &proof_hash,
    );

    assert_eq!(attestation.nullifier, nullifier);
    assert!(client.has_nullifier(&nullifier));

    let replay = client.try_submit_compliance(
        &subject_commitment,
        &public_input_hash,
        &nullifier,
        &proof_hash,
    );

    assert_eq!(replay, Err(Ok(Error::NullifierAlreadyUsed)));
}

#[test]
fn executes_regulated_action_once_after_attestation() {
    let env = Env::default();
    let contract_id = env.register(AnonComplianceContract, ());
    let client = AnonComplianceContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let actor = Address::generate(&env);
    let policy_hash = bytes32(&env, 1);
    let verifier_hash = bytes32(&env, 2);

    env.mock_all_auths();
    client.initialize(&admin, &policy_hash, &verifier_hash);

    let subject_commitment = bytes32(&env, 3);
    let public_input_hash = bytes32(&env, 4);
    let nullifier = bytes32(&env, 5);
    let proof_hash = hash(
        &env,
        &[
            subject_commitment.clone(),
            public_input_hash.clone(),
            nullifier.clone(),
            policy_hash.clone(),
            verifier_hash.clone(),
        ],
    );
    let action_hash = bytes32(&env, 8);

    client.submit_compliance(
        &subject_commitment,
        &public_input_hash,
        &nullifier,
        &proof_hash,
    );

    let action = client.execute_action(&actor, &nullifier, &action_hash);

    assert_eq!(action.actor, actor);
    assert_eq!(action.nullifier, nullifier);
    assert_eq!(action.action_hash, action_hash);
    assert_eq!(client.get_action(&nullifier).unwrap(), action);

    let replay = client.try_execute_action(&actor, &nullifier, &action_hash);
    assert_eq!(replay, Err(Ok(Error::ActionAlreadyExecuted)));
}

#[test]
fn rejects_action_without_attestation() {
    let env = Env::default();
    let contract_id = env.register(AnonComplianceContract, ());
    let client = AnonComplianceContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let actor = Address::generate(&env);
    let policy_hash = bytes32(&env, 1);
    let verifier_hash = bytes32(&env, 2);

    env.mock_all_auths();
    client.initialize(&admin, &policy_hash, &verifier_hash);

    let result = client.try_execute_action(&actor, &bytes32(&env, 5), &bytes32(&env, 8));
    assert_eq!(result, Err(Ok(Error::MissingAttestation)));
}

#[test]
fn rejects_invalid_demo_proof() {
    let env = Env::default();
    let contract_id = env.register(AnonComplianceContract, ());
    let client = AnonComplianceContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let policy_hash = bytes32(&env, 1);
    let verifier_hash = bytes32(&env, 2);

    env.mock_all_auths();
    client.initialize(&admin, &policy_hash, &verifier_hash);

    let result = client.try_submit_compliance(
        &bytes32(&env, 3),
        &bytes32(&env, 4),
        &bytes32(&env, 5),
        &bytes32(&env, 9),
    );

    assert_eq!(result, Err(Ok(Error::InvalidProof)));
}

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
};

#[contract]
pub struct AnonComplianceContract;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComplianceAttestation {
    pub subject_commitment: BytesN<32>,
    pub public_input_hash: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub policy_hash: BytesN<32>,
}

#[contracttype]
enum DataKey {
    Admin,
    PolicyHash,
    VerifierHash,
    UsedNullifier(BytesN<32>),
    Attestation(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    NullifierAlreadyUsed = 4,
    InvalidProof = 5,
}

#[contractimpl]
impl AnonComplianceContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        policy_hash: BytesN<32>,
        verifier_hash: BytesN<32>,
    ) -> Result<(), Error> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::PolicyHash, &policy_hash);
        env.storage()
            .persistent()
            .set(&DataKey::VerifierHash, &verifier_hash);

        env.events().publish(
            (symbol_short!("init"), admin),
            (policy_hash, verifier_hash),
        );

        Ok(())
    }

    pub fn update_policy(
        env: Env,
        admin: Address,
        policy_hash: BytesN<32>,
        verifier_hash: BytesN<32>,
    ) -> Result<(), Error> {
        require_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .set(&DataKey::PolicyHash, &policy_hash);
        env.storage()
            .persistent()
            .set(&DataKey::VerifierHash, &verifier_hash);

        env.events().publish(
            (symbol_short!("policy"), admin),
            (policy_hash, verifier_hash),
        );

        Ok(())
    }

    pub fn submit_compliance(
        env: Env,
        subject_commitment: BytesN<32>,
        public_input_hash: BytesN<32>,
        nullifier: BytesN<32>,
        proof_hash: BytesN<32>,
    ) -> Result<ComplianceAttestation, Error> {
        let policy_hash = get_policy_hash(&env)?;
        let verifier_hash = get_verifier_hash(&env)?;

        let nullifier_key = DataKey::UsedNullifier(nullifier.clone());
        if env.storage().persistent().has(&nullifier_key) {
            return Err(Error::NullifierAlreadyUsed);
        }

        if !verify_demo_proof(
            &env,
            &subject_commitment,
            &public_input_hash,
            &nullifier,
            &policy_hash,
            &verifier_hash,
            &proof_hash,
        ) {
            return Err(Error::InvalidProof);
        }

        let attestation = ComplianceAttestation {
            subject_commitment,
            public_input_hash,
            nullifier: nullifier.clone(),
            policy_hash,
        };

        env.storage().persistent().set(&nullifier_key, &true);
        env.storage()
            .persistent()
            .set(&DataKey::Attestation(nullifier.clone()), &attestation);

        env.events()
            .publish((symbol_short!("comply"), nullifier), &attestation);

        Ok(attestation)
    }

    pub fn has_nullifier(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::UsedNullifier(nullifier))
    }

    pub fn get_attestation(
        env: Env,
        nullifier: BytesN<32>,
    ) -> Option<ComplianceAttestation> {
        env.storage()
            .persistent()
            .get(&DataKey::Attestation(nullifier))
    }

    pub fn policy_hash(env: Env) -> Result<BytesN<32>, Error> {
        get_policy_hash(&env)
    }

    pub fn verifier_hash(env: Env) -> Result<BytesN<32>, Error> {
        get_verifier_hash(&env)
    }
}

fn require_admin(env: &Env, admin: &Address) -> Result<(), Error> {
    let stored_admin: Address = env
        .storage()
        .persistent()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;

    if &stored_admin != admin {
        return Err(Error::Unauthorized);
    }

    admin.require_auth();
    Ok(())
}

fn get_policy_hash(env: &Env) -> Result<BytesN<32>, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::PolicyHash)
        .ok_or(Error::NotInitialized)
}

fn get_verifier_hash(env: &Env) -> Result<BytesN<32>, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::VerifierHash)
        .ok_or(Error::NotInitialized)
}

fn verify_demo_proof(
    env: &Env,
    subject_commitment: &BytesN<32>,
    public_input_hash: &BytesN<32>,
    nullifier: &BytesN<32>,
    policy_hash: &BytesN<32>,
    verifier_hash: &BytesN<32>,
    proof_hash: &BytesN<32>,
) -> bool {
    let mut preimage = soroban_sdk::Bytes::new(env);
    preimage.append(&subject_commitment.clone().into());
    preimage.append(&public_input_hash.clone().into());
    preimage.append(&nullifier.clone().into());
    preimage.append(&policy_hash.clone().into());
    preimage.append(&verifier_hash.clone().into());

    let expected: BytesN<32> = env.crypto().sha256(&preimage).into();
    &expected == proof_hash
}

mod test;

import HealthKit

/// Maps Vigor metric keys (src/lib/metrics/catalog.ts) to HealthKit types and units.
/// Keep this table in sync with the server catalog when adding metrics.
struct QuantityMapping {
    let key: String
    let identifier: HKQuantityTypeIdentifier
    let unit: HKUnit
    /// Unit string sent to Vigor (must be accepted by src/lib/units.ts).
    let unitName: String
    var type: HKQuantityType { HKQuantityType(identifier) }
}

enum HealthTypes {
    static let quantities: [QuantityMapping] = [
        .init(key: "step_count", identifier: .stepCount, unit: .count(), unitName: "count"),
        .init(key: "distance_walking_running", identifier: .distanceWalkingRunning, unit: .meter(), unitName: "m"),
        .init(key: "active_energy", identifier: .activeEnergyBurned, unit: .kilocalorie(), unitName: "kcal"),
        .init(key: "basal_energy", identifier: .basalEnergyBurned, unit: .kilocalorie(), unitName: "kcal"),
        .init(key: "exercise_time", identifier: .appleExerciseTime, unit: .minute(), unitName: "min"),
        .init(key: "flights_climbed", identifier: .flightsClimbed, unit: .count(), unitName: "count"),
        .init(key: "heart_rate", identifier: .heartRate, unit: .count().unitDivided(by: .minute()), unitName: "count/min"),
        .init(key: "resting_heart_rate", identifier: .restingHeartRate, unit: .count().unitDivided(by: .minute()), unitName: "count/min"),
        .init(key: "walking_heart_rate", identifier: .walkingHeartRateAverage, unit: .count().unitDivided(by: .minute()), unitName: "count/min"),
        .init(key: "heart_rate_variability", identifier: .heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), unitName: "ms"),
        .init(key: "heart_rate_recovery", identifier: .heartRateRecoveryOneMinute, unit: .count().unitDivided(by: .minute()), unitName: "count/min"),
        .init(key: "oxygen_saturation", identifier: .oxygenSaturation, unit: .percent(), unitName: "fraction"),
        .init(key: "respiratory_rate", identifier: .respiratoryRate, unit: .count().unitDivided(by: .minute()), unitName: "count/min"),
        .init(key: "vo2_max", identifier: .vo2Max, unit: HKUnit(from: "ml/kg*min"), unitName: "ml/kg/min"),
        .init(key: "body_mass", identifier: .bodyMass, unit: .gramUnit(with: .kilo), unitName: "kg"),
        .init(key: "height", identifier: .height, unit: .meterUnit(with: .centi), unitName: "cm"),
        .init(key: "body_fat_percentage", identifier: .bodyFatPercentage, unit: .percent(), unitName: "fraction"),
        .init(key: "lean_body_mass", identifier: .leanBodyMass, unit: .gramUnit(with: .kilo), unitName: "kg"),
        .init(key: "body_mass_index", identifier: .bodyMassIndex, unit: .count(), unitName: "kg/m²"),
        .init(key: "waist_circumference", identifier: .waistCircumference, unit: .meterUnit(with: .centi), unitName: "cm"),
        .init(key: "dietary_energy", identifier: .dietaryEnergyConsumed, unit: .kilocalorie(), unitName: "kcal"),
        .init(key: "dietary_protein", identifier: .dietaryProtein, unit: .gram(), unitName: "g"),
        .init(key: "dietary_carbohydrates", identifier: .dietaryCarbohydrates, unit: .gram(), unitName: "g"),
        .init(key: "dietary_fat", identifier: .dietaryFatTotal, unit: .gram(), unitName: "g"),
        .init(key: "dietary_fiber", identifier: .dietaryFiber, unit: .gram(), unitName: "g"),
        .init(key: "dietary_sugar", identifier: .dietarySugar, unit: .gram(), unitName: "g"),
        .init(key: "dietary_sodium", identifier: .dietarySodium, unit: .gram(), unitName: "g"),
        .init(key: "dietary_caffeine", identifier: .dietaryCaffeine, unit: .gram(), unitName: "g"),
        .init(key: "dietary_water", identifier: .dietaryWater, unit: .literUnit(with: .milli), unitName: "mL"),
        .init(key: "body_temperature", identifier: .bodyTemperature, unit: .degreeCelsius(), unitName: "degC"),
        .init(key: "blood_pressure_systolic", identifier: .bloodPressureSystolic, unit: .millimeterOfMercury(), unitName: "mmHg"),
        .init(key: "blood_pressure_diastolic", identifier: .bloodPressureDiastolic, unit: .millimeterOfMercury(), unitName: "mmHg"),
        .init(key: "blood_glucose", identifier: .bloodGlucose, unit: HKUnit(from: "mg/dL"), unitName: "mg/dL"),
    ]

    static let sleep = HKCategoryType(.sleepAnalysis)
    static let standHour = HKCategoryType(.appleStandHour)
    static let workout = HKObjectType.workoutType()

    /// Everything the app asks permission to read.
    static var readTypes: Set<HKObjectType> {
        var s = Set<HKObjectType>(quantities.map(\.type))
        s.insert(sleep)
        s.insert(standHour)
        s.insert(workout)
        return s
    }

    /// Scopes = Vigor cursor scopes, one HealthKit anchor each.
    static var allScopes: [String] { quantities.map(\.key) + ["sleep_analysis", "stand_hours", "workouts"] }

    static func sampleType(forScope scope: String) -> HKSampleType? {
        if let q = quantities.first(where: { $0.key == scope }) { return q.type }
        switch scope {
        case "sleep_analysis": return sleep
        case "stand_hours": return standHour
        case "workouts": return workout
        default: return nil
        }
    }

    static func sleepCategory(_ value: Int) -> String? {
        switch HKCategoryValueSleepAnalysis(rawValue: value) {
        case .inBed: return "in_bed"
        case .awake: return "awake"
        case .asleepUnspecified: return "asleep_unspecified"
        case .asleepCore: return "asleep_core"
        case .asleepDeep: return "asleep_deep"
        case .asleepREM: return "asleep_rem"
        default: return nil
        }
    }

    static func activityName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: return "running"
        case .walking: return "walking"
        case .hiking: return "hiking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        case .rowing: return "rowing"
        case .elliptical: return "elliptical"
        case .yoga: return "yoga"
        case .traditionalStrengthTraining: return "strength_training"
        case .functionalStrengthTraining: return "functional_strength_training"
        case .highIntensityIntervalTraining: return "hiit"
        case .coreTraining: return "core_training"
        case .crossTraining: return "cross_training"
        case .stairClimbing: return "stair_climbing"
        default: return "other_\(t.rawValue)"
        }
    }
}

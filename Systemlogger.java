public class SensorReading{
//Has int temperature, int humidity
//Has a constructor
//Override toString() to return something like:
//Temperature: 23°C, Humidity: 40% 

int temperature;
int humidity;

public SensorReading(int temperature ,int humidity){
this.temperature = temperature ;
this.humidity = humidity;
}

String toString(){
    return "Humidity is " + humidity + "  and Temperature is " + temperature ;
}
}

public class SystemLogger{
    public static void main(String[] args){
        SensorReading Sensor = new SensorReading(23, 48);
         System.out.println(Sensor);
    }
}